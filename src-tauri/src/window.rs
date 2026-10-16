//! 窗口行为：关闭=隐藏到托盘、show_window（破 Windows 前台锁）、渲染进程崩溃自愈。
//! 对应旧版 `src/main/index.ts` 与 `src/main/lib/tray.ts` 的窗口部分。

use std::sync::atomic::Ordering;

use tauri::{AppHandle, Emitter, Manager};

use crate::state::AppState;

/// 渲染进程连续崩溃次数上限（成功加载后归零；超过不再自动重载）
pub const RENDERER_RELOAD_LIMIT: usize = 3;

/// 显示窗口：恢复最小化 → 临时置顶 → show → focus → 立刻交还层级。
/// Windows 的 SetForegroundWindow 带前台锁定：从资源管理器/任务栏双击进来时
/// 直接 focus() 会被系统拒绝，借一次临时置顶打断它；**必须交还**（旧版 step18 专门断言）。
pub fn show_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        if win.is_minimized().unwrap_or(false) {
            let _ = win.unminimize();
        }
        let _ = win.set_always_on_top(true);
        let _ = win.show();
        let _ = win.set_focus();
        let _ = win.set_always_on_top(false);
    }
}

/// 托盘左键点击：可见且未最小化 → 隐藏；否则显示
pub fn toggle_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let visible = win.is_visible().unwrap_or(false);
        let minimized = win.is_minimized().unwrap_or(false);
        if visible && !minimized {
            let _ = win.hide();
        } else {
            show_window(app);
        }
    }
}

/// 渲染进程崩溃自愈：挂 WebView2 的 ProcessFailed，RenderProcessExited 时重载页面。
/// 渲染进程一死窗口不会消失、只会留一块永远不刷新的空白 —— 关窗口又是隐藏到托盘，
/// 用户既没提示也没出路（表现为「应用全部变白」），必须自愈。
#[cfg(windows)]
pub fn install_crash_watchdog(app: &AppHandle) {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        COREWEBVIEW2_PROCESS_FAILED_KIND, COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED,
    };

    let Some(win) = app.get_webview_window("main") else {
        return;
    };
    let app_for_cb = app.clone();
    let _ = win.with_webview(move |platform| {
        let controller = platform.controller();
        let core = match unsafe { controller.CoreWebView2() } {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[renderer] 获取 CoreWebView2 失败: {e}");
                return;
            }
        };
        let handler = webview2_com::ProcessFailedEventHandler::create(Box::new(move |_sender, args| {
            let mut kind = COREWEBVIEW2_PROCESS_FAILED_KIND::default();
            let got = args
                .map(|a| unsafe { a.ProcessFailedKind(&mut kind).is_ok() })
                .unwrap_or(false);
            if got {
                crate::bootlog::mark(&format!("process_failed kind={}", kind.0));
                if kind == COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED {
                    handle_renderer_gone(&app_for_cb);
                }
            } else {
                crate::bootlog::mark("process_failed kind=unknown");
            }
            Ok(())
        }));
        let mut token = 0i64;
        if let Err(e) = unsafe { core.add_ProcessFailed(&handler, &mut token) } {
            eprintln!("[renderer] 注册 ProcessFailed 失败: {e}");
        }
    });
}

#[cfg(windows)]
fn handle_renderer_gone(app: &AppHandle) {
    let state = app.state::<AppState>();
    let n = state.renderer_crashes.fetch_add(1, Ordering::SeqCst) + 1;
    eprintln!("[renderer] 进程崩溃，第 {n} 次");
    crate::bootlog::mark(&format!("renderer_crashed n={n}"));
    if n > RENDERER_RELOAD_LIMIT {
        eprintln!("[renderer] 连续崩溃超过上限，停止自动重载，请手动重启应用");
        return;
    }
    let app2 = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(win) = app2.get_webview_window("main") {
            let _ = win.with_webview(|platform| unsafe {
                if let Ok(core) = platform.controller().CoreWebView2() {
                    let _ = core.Reload();
                }
            });
        }
    });
}

/// 页面加载完成（每次刷新/重载都会触发）：
/// - 成功加载即视为恢复：崩过则置 renderer_recovered（粘住），计数归零；
/// - 首次加载还要：show 窗口、推托盘计数、发启动告警、跑冒烟/崩溃注入。
pub fn on_page_load_finished(app: &AppHandle) {
    let state = app.state::<AppState>();
    let crashes = state.renderer_crashes.swap(0, Ordering::SeqCst);
    if crashes > 0 {
        state.renderer_recovered.store(true, Ordering::SeqCst);
        crate::bootlog::mark(&format!("renderer_recovered after={crashes}"));
    }

    let first = {
        // 用 last_notification_body 之外的独立标记不必要：首载由 OnceLock 语义控制
        // 这里用 setup 阶段注册的布尔：见 FIRST_LOAD
        let done = FIRST_LOAD.load(Ordering::SeqCst);
        if !done {
            FIRST_LOAD.store(true, Ordering::SeqCst);
        }
        !done
    };
    if !first {
        return;
    }

    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
    }
    crate::bootlog::mark("page_load_finished");
    crate::bootlog::snapshot("first_load");
    crate::tray::set_today_count(app, state.due_count());

    // 启动告警：损坏文件 / 种子写入失败（对应旧版 did-finish-load 里的一次性提示）
    let warning = state.take_startup_warning();
    if !warning.is_empty() {
        let _ = app.emit("ui:open-dialog", serde_json::json!(["warning", warning]));
    }

    if crate::smoke::is_smoke_mode() {
        crate::smoke::maybe_schedule_crash_probe(app);
        crate::smoke::run_script(app);
        return;
    }
    crate::notify::start_notify_loop(app.clone());
}

static FIRST_LOAD: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
