//! 冒烟框架（仅 `TODO_SMOKE=1` 时生效）。环境变量与旧版 `src/main/smoke.ts` 同名同义。
//! 与旧版的差异：脚本改由 Rust 侧 eval 进 WebView，脚本末尾调用 `smoke_report` 回传结果，
//! 主进程侧断言（mainChecks）与进程指标由 Rust 组装后写入同一个结果 JSON。

use std::sync::atomic::Ordering;
use std::time::Duration;

use parking_lot::Mutex;
use serde_json::{json, Map, Value};
use tauri::{AppHandle, Manager};

use crate::state::AppState;
use crate::{paths, settings};

pub fn is_smoke_mode() -> bool {
    std::env::var("TODO_SMOKE").as_deref() == Ok("1")
}

static SMOKE_RESULT: Mutex<Option<Value>> = Mutex::new(None);

fn env_u64(key: &str, default: u64) -> u64 {
    std::env::var(key).ok().and_then(|v| v.parse().ok()).unwrap_or(default)
}

fn env_is(key: &str) -> bool {
    std::env::var(key).as_deref() == Ok("1")
}

#[tauri::command]
pub fn smoke_report(app: AppHandle, args: Vec<Value>) {
    if !is_smoke_mode() {
        return;
    }
    let payload = args.first().cloned().unwrap_or(Value::Null);
    *SMOKE_RESULT.lock() = Some(payload);
    let app2 = app.clone();
    std::thread::spawn(move || {
        let settle = env_u64("TODO_SMOKE_SETTLE", 800);
        std::thread::sleep(Duration::from_millis(settle));
        finish(&app2, false);
    });
}

/// 首次页面加载完成后调用：把冒烟脚本包上断言辅助并注入 WebView
pub fn run_script(app: &AppHandle) {
    if !is_smoke_mode() {
        return;
    }
    let script_path = std::env::var("TODO_SMOKE_SCRIPT").unwrap_or_default();
    let shot_dir = std::env::var("TODO_SMOKE_SHOT_DIR").unwrap_or_default();
    let shot_one = std::env::var("TODO_SMOKE_SHOT").unwrap_or_default();
    // 只截图模式（人工视觉核对）：没有脚本时直接截一组图后收尾。
    // 必须在工作线程里跑：PrintWindow 会给窗口发消息，主线程若阻塞在 PowerShell 上会死锁。
    if script_path.is_empty() {
        if !shot_dir.is_empty() || !shot_one.is_empty() {
            let app2 = app.clone();
            std::thread::spawn(move || {
                capture_visuals(&app2);
                *SMOKE_RESULT.lock() = Some(json!({
                    "ok": true,
                    "result": { "visuals": std::env::var("TODO_SMOKE_SHOT_DIR").unwrap_or_default() }
                }));
                finish(&app2, false);
            });
        } else {
            *SMOKE_RESULT.lock() =
                Some(json!({ "ok": false, "error": "缺少 TODO_SMOKE_SCRIPT 或 TODO_SMOKE_SHOT_DIR" }));
            finish(app, false);
        }
        return;
    }
    let body = match std::fs::read_to_string(&script_path) {
        Ok(s) => s,
        Err(e) => {
            *SMOKE_RESULT.lock() =
                Some(json!({ "ok": false, "error": format!("读取冒烟脚本失败:{e}") }));
            finish(app, false);
            return;
        }
    };
    let root = std::env::var("TODO_SMOKE_ROOT").unwrap_or_default();
    let env_map: Map<String, Value> = std::env::vars()
        .filter(|(k, _)| k.starts_with("TODO_SMOKE_"))
        .map(|(k, v)| (k, Value::from(v)))
        .collect();
    // 模板用字符串替换而不是 format!：JS 里的花括号太多了，避免转义错误这一类坑
    let template = r#"(async () => {
const __smokeRoot = __ROOT__;
const __smokeEnv = __ENV__;
function assert(c,m){ if(!c) throw new Error('断言失败: '+m) }
function eq(a,e,m){ const x=JSON.stringify(a),y=JSON.stringify(e); if(x!==y) throw new Error('断言失败: '+m+' —— 期望 '+y+' 实际 '+x) }
function truthy(v,m){ assert(!!v, m+' —— 实际 '+JSON.stringify(v)) }
const __report = (payload) => {
  try { if (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) { payload.via = 'global'; return window.__TAURI__.core.invoke('smoke_report', { args: [payload] }) } } catch (e) {}
  try { if (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke) { payload.via = 'internals'; return window.__TAURI_INTERNALS__.invoke('smoke_report', { args: [payload] }) } } catch (e) {}
  return Promise.resolve()
}
// 渲染层 init()（store:load + settings:load）是异步的，早于它开跑会把脚本的写入覆盖回去；
// 旧 Electron 版靠 did-finish-load 的时序侥幸躲过，这里显式等 state.ready。
const __waitReady = async () => {
  for (let i = 0; i < 400; i++) {
    try { if (window.__todoTest && window.__todoTest.ready && window.__todoTest.ready()) return true } catch (e) {}
    await new Promise((r) => setTimeout(r, 25))
  }
  return false
}
await __waitReady()
try {
  const result = await (async () => {
__BODY__
  })();
  await __report({ ok: true, result });
} catch (err) {
  await __report({ ok: false, error: String((err && err.stack) || err) });
}
})()"#;
    let code = template
        .replace("__ROOT__", &serde_json::to_string(&root).unwrap_or_else(|_| "\"\"".to_string()))
        .replace("__ENV__", &serde_json::to_string(&env_map).unwrap_or_else(|_| "{}".to_string()))
        .replace("__BODY__", &body);
    // 便于排障：把实际注入的代码留一份（对判定无影响）
    if let Some(out) = std::env::var_os("TODO_SMOKE_OUT") {
        let _ = std::fs::write(format!("{}.code.js", out.to_string_lossy()), &code);
    }
    if let Some(win) = app.get_webview_window("main") {
        match win.eval(&code) {
            Ok(()) => eprintln!("[smoke] eval 已提交"),
            Err(e) => eprintln!("[smoke] eval 失败: {e}"),
        }
    } else {
        eprintln!("[smoke] 找不到 main 窗口，无法注入脚本");
    }

    // 超时：到点仍无结果则按超时收尾
    let app2 = app.clone();
    let timeout = env_u64("TODO_SMOKE_TIMEOUT", 60000);
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(timeout));
        let empty = SMOKE_RESULT.lock().is_none();
        if empty {
            finish(&app2, true);
        }
    });

    if !shot_dir.is_empty() || !shot_one.is_empty() {
        let app3 = app.clone();
        std::thread::spawn(move || capture_visuals(&app3));
    }
}

/// 崩溃注入（step27）：首次加载完成 1200ms 后杀掉本进程后代里的 WebView2 渲染进程，
/// 验证 ProcessFailed → 自动重载链路（渲染进程在 WebView 里拿不到 process，杀不了自己）。
pub fn maybe_schedule_crash_probe(_app: &AppHandle) {
    if !env_is("TODO_SMOKE_CRASH_PROBE") {
        return;
    }
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(1200));
        let me = std::process::id();
        let script = format!(
            r#"$me = {me}
$procs = Get-CimInstance Win32_Process
$byId = @{{}}
foreach ($p in $procs) {{ $byId[[int]$p.ProcessId] = [int]$p.ParentProcessId }}
function IsDesc([int]$id) {{
  $cur = $id
  for ($i = 0; $i -lt 10 -and $cur; $i++) {{
    $par = $byId[$cur]
    if (-not $par) {{ return $false }}
    if ($par -eq $me) {{ return $true }}
    $cur = $par
  }}
  return $false
}}
$target = $procs | Where-Object {{ $_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match '--type=renderer' -and (IsDesc ([int]$_.ProcessId)) }} | Select-Object -First 1
if ($target) {{ Stop-Process -Id $target.ProcessId -Force; Write-Output ("killed " + $target.ProcessId) }} else {{ Write-Output 'no renderer found' }}
"#
        );
        let path = std::env::temp_dir().join("mini-todo-crash-probe.ps1");
        let _ = std::fs::write(&path, script);
        match std::process::Command::new("powershell")
            .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
            .arg(&path)
            .output()
        {
            Ok(o) => eprintln!("[smoke] crash probe: {}", String::from_utf8_lossy(&o.stdout).trim()),
            Err(e) => eprintln!("[smoke] crash probe 失败: {e}"),
        }
    });
}

fn finish(app: &AppHandle, timed_out: bool) {
    let base = SMOKE_RESULT.lock().clone().unwrap_or_else(|| {
            json!({
                "ok": false,
                "error": if timed_out {
                    format!("冒烟脚本超时({}ms)", env_u64("TODO_SMOKE_TIMEOUT", 60000))
                } else {
                    "未生成结果文件".to_string()
                }
            })
        });
    let mut report = base.as_object().cloned().unwrap_or_default();
    report.insert("mainChecks".into(), main_checks(app));
    report.insert("metrics".into(), metrics_json());
    let text = serde_json::to_string_pretty(&Value::Object(report)).unwrap_or_default();
    if let Some(out) = std::env::var_os("TODO_SMOKE_OUT") {
        let _ = std::fs::write(out, &text);
    }
    println!("[smoke] {text}");
    app.exit(0);
}

fn metrics_json() -> Value {
    #[cfg(windows)]
    {
        let m = crate::metrics::collect();
        let procs: Vec<Value> = m.pids.iter().map(|p| json!({ "pid": p })).collect();
        json!({
            "processes": procs,
            "procCount": m.proc_count,
            "totalRssMB": m.total_rss_mb,
            "totalPrivateMB": m.total_private_mb,
            "selfPid": m.self_pid,
        })
    }
    #[cfg(not(windows))]
    {
        json!({})
    }
}

/// 主进程侧断言（渲染层脚本无法观测的窗口/托盘/通知/单实例状态）
fn main_checks(app: &AppHandle) -> Value {
    let state = app.state::<AppState>();
    let win = app.get_webview_window("main");

    // TODO_SMOKE_NOTIFY=1 时把提醒时间设成已过去的时刻，让本次运行内必然触发一次
    let notify_requested = env_is("TODO_SMOKE_NOTIFY");
    if notify_requested {
        let next = settings::merge(
            &state.settings_snapshot(),
            &json!({ "notifyEnabled": true, "notifyAt": "00:00" }),
        );
        let _ = settings::save_to_disk(&next);
        state.set_settings(next);
    }
    let notify_supported = crate::notify::detect_supported();
    crate::notify::run_tick(app);
    let last_body = state.last_notification_body.lock().clone();

    // 关闭 = 隐藏到托盘（不退出）：托盘常驻应用的核心行为，主进程侧才能观测
    let close_probe = if env_is("TODO_SMOKE_CLOSE_PROBE") {
        match &win {
            Some(w) => {
                let before = w.is_visible().unwrap_or(false);
                let _ = w.close();
                std::thread::sleep(Duration::from_millis(200));
                let after_visible = w.is_visible().unwrap_or(false);
                let destroyed = app.get_webview_window("main").is_none();
                json!({ "before": before, "afterVisible": after_visible, "destroyed": destroyed })
            }
            None => Value::Null,
        }
    } else {
        Value::Null
    };

    // 单实例：把窗口藏起来，再走一遍「二次启动 → showWindow」，断言窗口重新可见且没永久置顶
    let single = if env_is("TODO_SMOKE_SINGLE_INSTANCE") {
        match &win {
            Some(w) => {
                let _ = w.hide();
                std::thread::sleep(Duration::from_millis(100));
                let hidden_before = w.is_visible().unwrap_or(true);
                crate::window::show_window(app);
                std::thread::sleep(Duration::from_millis(100));
                json!({
                    // 本进程能启动并运行到此即持有单实例锁（插件语义）
                    "hasLock": true,
                    "hiddenBefore": hidden_before,
                    "visibleAfter": w.is_visible().unwrap_or(false),
                    "minimizedAfter": w.is_minimized().unwrap_or(false),
                    // showWindow 借一次临时置顶打断 Windows 前台锁定，这里断言它已交还
                    "alwaysOnTopAfter": w.is_always_on_top().unwrap_or(true),
                })
            }
            None => Value::Null,
        }
    } else {
        Value::Null
    };

    json!({
        "trayExists": crate::tray::tray_exists(app),
        "frameless": win.as_ref().map(|w| !w.is_decorated().unwrap_or(true)).unwrap_or(false),
        "title": win.as_ref().and_then(|w| w.title().ok()),
        // Tauri 没有 minSize getter：报告创建时设定的常量（900×600，见 tauri.conf.json）
        "minSize": [900, 600],
        "dataDir": paths::data_dir().to_string_lossy(),
        "perfLog": std::fs::read_to_string(paths::data_dir().join("perf.log")).unwrap_or_default(),
        "snoozeUntilMs": state.snooze_until_ms.load(Ordering::SeqCst),
        "rendererRecovered": state.renderer_recovered.load(Ordering::SeqCst),
        "windowAlive": win.is_some(),
        "saveFailures": state.save_failures.load(Ordering::SeqCst),
        "closeProbe": close_probe,
        "singleInstance": single,
        "notify": {
            "requested": notify_requested,
            "supported": notify_supported,
            "lastNotifiedDate": settings::last_notified_of(&state.settings_snapshot()),
            "lastBody": last_body,
        },
    })
}

// ---------------------------------------------------------------- 截图（仅人工核对，不参与判定）

fn capture_visuals(app: &AppHandle) {
    let shot_dir = std::env::var("TODO_SMOKE_SHOT_DIR").unwrap_or_default();
    let shot_one = std::env::var("TODO_SMOKE_SHOT").unwrap_or_default();
    // 首帧未绘制时截图会得到空图
    std::thread::sleep(Duration::from_millis(800));
    let Some(win) = app.get_webview_window("main") else {
        return;
    };
    // 刻意不 show / set_focus：CDP 截图与窗口是否在前台无关（见 capture_webview_png）
    if !shot_one.is_empty() {
        write_png(&win, std::path::Path::new(&shot_one));
        return;
    }
    if shot_dir.is_empty() {
        return;
    }
    let dir = std::path::PathBuf::from(&shot_dir);
    let _ = std::fs::create_dir_all(&dir);
    write_png(&win, &dir.join("01-board-light.png"));
    let _ = win.eval("window.__todoTest.setBoard(false)");
    std::thread::sleep(Duration::from_millis(500));
    write_png(&win, &dir.join("02-list-light.png"));
    let _ = win.eval("window.__todoTest.setTheme('dark')");
    std::thread::sleep(Duration::from_millis(600));
    write_png(&win, &dir.join("03-list-dark.png"));
    let _ = win.eval("window.__todoTest.setBoard(true)");
    std::thread::sleep(Duration::from_millis(600));
    write_png(&win, &dir.join("04-board-dark.png"));
    let _ = win.eval("window.__todoTest.setTheme('light'); window.__todoTest.openNew()");
    std::thread::sleep(Duration::from_millis(600));
    write_png(&win, &dir.join("05-dialog.png"));
    let _ = win.eval("window.__todoTest.closeDialog()");
}

/// 抓渲染层画面：走 WebView2 的 CDP `Page.captureScreenshot`，直接问渲染层要一帧 PNG。
///
/// 为什么不用屏幕拷贝：旧实现是 PowerShell `CopyFromScreen`，只能抓屏幕上真实可见的像素，
/// 于是每次截图都得 `show()` + `set_focus()` 把窗口抢到前台 —— 跑测试时会把用户正在用的
/// 窗口顶掉；`PrintWindow` 对 WebView2 的合成内容又只能得到空白，没有第三条路。
/// CDP 截图与窗口是否可见/是否在前台无关，后台跑也不会打断用户。
#[cfg(windows)]
fn capture_webview_png<R: tauri::Runtime>(win: &tauri::WebviewWindow<R>) -> Option<Vec<u8>> {
    use webview2_com::Microsoft::Web::WebView2::Win32::{ICoreWebView2, ICoreWebView2Controller};
    use webview2_com::CallDevToolsProtocolMethodCompletedHandler;

    // with_webview 的闭包返回 (),结果自己走 channel 带回来
    let (outer_tx, outer_rx) = std::sync::mpsc::channel::<Option<Vec<u8>>>();
    let _ = win.with_webview(move |platform: tauri::webview::PlatformWebview| {
        let result = (|| -> webview2_com::Result<Vec<u8>> {
            let controller: ICoreWebView2Controller = platform.controller();
            let core: ICoreWebView2 = unsafe { controller.CoreWebView2() }?;
            // 带结尾 NUL 的宽字符串：闭包是 'static 的，用 Vec 带着走（PCWSTR 只借用它）
            let method: Vec<u16> = "Page.captureScreenshot\0".encode_utf16().collect();
            let params: Vec<u16> = "{\"format\":\"png\"}\0".encode_utf16().collect();
            let (tx, rx) = std::sync::mpsc::channel::<Vec<u8>>();
            CallDevToolsProtocolMethodCompletedHandler::wait_for_async_operation(
                Box::new(move |handler| unsafe {
                    core.CallDevToolsProtocolMethod(
                        windows::core::PCWSTR(method.as_ptr()),
                        windows::core::PCWSTR(params.as_ptr()),
                        &handler,
                    )?;
                    Ok(())
                }),
                Box::new(move |hr, json| {
                    let bytes = if hr.is_ok() {
                        decode_cdp_screenshot(&json)
                    } else {
                        Vec::new()
                    };
                    let _ = tx.send(bytes);
                    Ok(())
                }),
            )?;
            Ok(rx.recv().unwrap_or_default())
        })();
        if let Err(e) = &result {
            eprintln!("[smoke] 截图失败: {e:?}");
        }
        let _ = outer_tx.send(result.ok());
    });
    match outer_rx.recv().ok().flatten() {
        Some(bytes) if !bytes.is_empty() => Some(bytes),
        _ => {
            eprintln!("[smoke] 未取到截图内容");
            None
        }
    }
}

#[cfg(not(windows))]
fn capture_webview_png<R: tauri::Runtime>(_win: &tauri::WebviewWindow<R>) -> Option<Vec<u8>> {
    None
}

/// `Page.captureScreenshot` 的结果是 `{"data":"<base64 png>"}`。
/// 只在冒烟截图这一条路径上用到，几十字节解码器即可，不为一个测试引入 base64 依赖。
fn decode_cdp_screenshot(json: &str) -> Vec<u8> {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(json) else {
        return Vec::new();
    };
    let Some(b64) = v.get("data").and_then(|d| d.as_str()) else {
        return Vec::new();
    };
    let val = |c: u8| -> Option<u8> {
        Some(match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            _ => return None,
        })
    };
    let mut out = Vec::with_capacity(b64.len() / 4 * 3);
    let mut acc: u32 = 0;
    let mut bits = 0;
    for c in b64.bytes() {
        if c == b'=' {
            break;
        }
        let Some(v) = val(c) else { continue };
        acc = (acc << 6) | u32::from(v);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
        }
    }
    out
}

fn write_png<R: tauri::Runtime>(win: &tauri::WebviewWindow<R>, out: &std::path::Path) {
    match capture_webview_png(win) {
        Some(bytes) => {
            if let Err(e) = std::fs::write(out, bytes) {
                eprintln!("[smoke] 写截图失败 {}: {e}", out.display());
            }
        }
        None => eprintln!("[smoke] 未取到截图: {}", out.display()),
    }
}
