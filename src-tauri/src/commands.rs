//! Tauri 命令：对应旧版 `src/main/ipc.ts` 的 9 个 invoke handler 与菜单动作。
//! 约定：命令永不返回 Err（失败一律 `{ok:false,error}`），与旧版 `guard()` 一致 ——
//! 渲染层从不 try/catch，只看 `ok`。

use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

use crate::paths;
use crate::settings;
use crate::state::AppState;
use crate::store_io;
use crate::{dates, normalize, tray};

fn err(e: impl std::fmt::Display) -> Value {
    json!({ "ok": false, "error": e.to_string() })
}

fn first_arg(args: &[Value]) -> Value {
    args.first().cloned().unwrap_or(Value::Null)
}

// ---------------------------------------------------------------- 9 个 IPC 命令

static STORE_LOAD_MARKED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

#[tauri::command]
pub fn store_load(app: AppHandle, state: State<'_, AppState>) -> Value {
    if !STORE_LOAD_MARKED.swap(true, Ordering::SeqCst) {
        crate::bootlog::mark("store_load");
    }
    let loaded = store_io::load_store();
    state.set_store(loaded.store.clone());
    let count = crate::scan::count_due(&loaded.store);
    tray::set_today_count(&app, count);
    let path = paths::store_path().to_string_lossy().to_string();
    let warning = if loaded.warning.is_empty() {
        store_io::consume_load_warning()
    } else {
        loaded.warning
    };
    json!({ "ok": true, "store": loaded.store, "path": path, "warning": warning })
}

#[tauri::command]
pub fn store_save(app: AppHandle, state: State<'_, AppState>, args: Vec<Value>) -> Value {
    let payload = first_arg(&args);
    // 渲染层以序列化字符串发送（传对象要结构化克隆 7.5 万个对象）；字符串原样字节落盘
    let (bytes, parsed): (Vec<u8>, Value) = match &payload {
        Value::String(s) => match serde_json::from_str::<Value>(s) {
            // 字符串分支要同时拿到「可落盘的字节」与「解析后的树」：一次拷贝换掉整棵 Value 的深拷贝
            Ok(v) => (s.as_bytes().to_vec(), v),
            Err(e) => return err(format!("数据格式非法:{e}")),
        },
        other => match serde_json::to_string(other) {
            Ok(s) => match serde_json::from_str::<Value>(&s) {
                Ok(v) => (s.into_bytes(), v),
                Err(e) => return err(format!("数据格式非法:{e}")),
            },
            Err(e) => return err(e),
        },
    };
    // 轻量校验而非逐条 normalizeStore（渲染层由 store-ops 纯函数写入；导入路径才全量归一化）
    if let Err(e) = store_io::assert_store_shape(&parsed) {
        return err(e);
    }
    if let Err(e) = store_io::save_store(&bytes) {
        state.save_failures.fetch_add(1, Ordering::SeqCst);
        return err(e);
    }
    // 每天一份自动备份。此前只挂在导入路径上，日常使用根本不产生备份（README 承诺的
    // 「每天自动备份、保留最新 10 份」等于没有）。backup_if_due 自带当天去重，故每次保存都调。
    // 备份失败绝不影响保存结果：数据已经落盘，只记日志。
    if let Err(e) = store_io::backup_if_due(&parsed) {
        eprintln!("[store] 每日备份失败: {e}");
    }
    // 托盘计数在 store 交接前借用着算,省掉 store_snapshot() 那次整树深拷贝（1 MB 载荷实测约 13 ms）
    let count = state.store_scan(crate::scan::count_due, 0, Some(parsed));
    tray::set_today_count(&app, count);
    // 刻意不回传 store（回传会让每次保存多克隆 ~1MB）
    json!({ "ok": true })
}

#[tauri::command]
pub async fn store_import(app: AppHandle, args: Vec<Value>) -> Value {
    let preset = first_arg(&args).as_str().map(|s| s.to_string());
    match do_import(&app, preset.map(PathBuf::from)) {
        Ok(ImportOutcome::Canceled) => json!({ "ok": true, "canceled": true }),
        Ok(ImportOutcome::Picked { store, source, counts }) => {
            json!({ "ok": true, "canceled": false, "store": store, "source": source, "counts": counts })
        }
        Err(e) => err(e),
    }
}

#[tauri::command]
pub async fn store_export(app: AppHandle, args: Vec<Value>) -> Value {
    let payload = first_arg(&args);
    if let Err(e) = store_io::assert_store_shape(&payload) {
        return err(e);
    }
    match save_file_blocking(&app, format!("todos-{}.json", dates::stamp_min())) {
        Ok(Some(path)) => match store_io::export_to_file(&path, &payload) {
            Ok(()) => json!({ "ok": true, "canceled": false, "path": path.to_string_lossy() }),
            Err(e) => err(e),
        },
        Ok(None) => json!({ "ok": true, "canceled": true }),
        Err(e) => err(e),
    }
}

/// 导出文本的上限（5 MB）。渲染层最多导出几千条任务，超过这个量级说明传错了东西。
const MAX_EXPORT_BYTES: usize = 5_000_000;

/// 文件名净化：Windows 非法字符一律剔除（否则写盘必然失败），再限长 80 字符。
pub fn safe_file_name(name: &str, ext: &str, fallback: &str) -> String {
    let cleaned: String = name.chars().filter(|c| !r#"\ / : * ? " < > |"#.contains(*c)).collect();
    let trimmed = cleaned.trim();
    if trimmed.is_empty() {
        return format!("{fallback}.{ext}");
    }
    let mut s: String = trimmed.chars().take(80).collect();
    if !s.to_lowercase().ends_with(&format!(".{ext}")) {
        s.push_str(&format!(".{ext}"));
    }
    s
}

/// 导出纯文本（Markdown / CSV）。文本由渲染层生成（src/shared/export-text.ts），
/// 这里只负责选文件名与过滤器、必要时加 BOM、写盘。
#[tauri::command]
pub async fn export_text(app: AppHandle, args: Vec<Value>) -> Value {
    let payload = first_arg(&args);
    let Some(obj) = payload.as_object() else {
        return err("导出参数格式非法");
    };
    let text = obj.get("text").and_then(|v| v.as_str()).unwrap_or("");
    if text.is_empty() {
        return err("没有可导出的内容");
    }
    if text.len() > MAX_EXPORT_BYTES {
        return err("导出内容过大（超过 5 MB）");
    }
    let format = obj.get("format").and_then(|v| v.as_str()).unwrap_or("");
    let (ext, filter) = match format {
        "md" => ("md", "Markdown"),
        "csv" => ("csv", "CSV"),
        _ => return err(format!("不支持的导出格式：{format}")),
    };
    let name = safe_file_name(
        obj.get("name").and_then(|v| v.as_str()).unwrap_or(""),
        ext,
        "迷你待办-导出",
    );
    // csv 要前置 BOM：Excel 按本地代码页读无 BOM 的 UTF-8，中文全是乱码
    let body = if format == "csv" { format!("\u{feff}{text}") } else { text.to_string() };

    // 冒烟注入：脚本点不了系统保存对话框，指定目录时直接按默认名写进去（与 TODO_SMOKE_SAVE_FAIL 同款探针）
    let injected = std::env::var("TODO_SMOKE_EXPORT_DIR")
        .ok()
        .filter(|d| !d.is_empty() && std::path::Path::new(d).is_dir());
    let picked = match injected {
        Some(dir) => Some(std::path::Path::new(&dir).join(&name)),
        None => match save_file_blocking_ext(&app, "导出为 Markdown / CSV", name, filter, &[ext]) {
            Ok(p) => p,
            Err(e) => return err(e),
        },
    };
    let Some(path) = picked else {
        return json!({ "ok": true, "canceled": true });
    };
    match std::fs::write(&path, body.as_bytes()) {
        Ok(()) => json!({ "ok": true, "canceled": false, "path": path.to_string_lossy() }),
        Err(e) => err(e),
    }
}

#[tauri::command]
pub fn store_open_dir(app: AppHandle, args: Vec<Value>) -> Value {
    // 带 "backups" 时开备份子目录（「从备份恢复」里的入口），否则仍是数据目录
    let dir = if first_arg(&args).as_str() == Some("backups") {
        paths::backup_dir()
    } else {
        paths::data_dir()
    };
    open_dir(&app, dir)
}

/// 列出备份供「从备份恢复」用：损坏的文件也列出来（标 ok:false 并禁用恢复按钮），
/// 否则用户只会看到「一份备份都没有」，误以为备份功能没生效。
#[tauri::command]
pub fn backups_list() -> Value {
    let items: Vec<Value> = store_io::list_backups()
        .into_iter()
        .map(|p| {
            let name = p.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
            let mtime_ms = std::fs::metadata(&p)
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            match store_io::import_from_file(&p) {
                Ok(r) => json!({
                    "name": name,
                    "path": p.to_string_lossy(),
                    "mtimeMs": mtime_ms,
                    "ok": true,
                    "counts": r.counts
                }),
                Err(e) => json!({
                    "name": name,
                    "path": p.to_string_lossy(),
                    "mtimeMs": mtime_ms,
                    "ok": false,
                    "error": e
                }),
            }
        })
        .collect();
    json!({ "ok": true, "dir": paths::backup_dir().to_string_lossy(), "items": items })
}

#[tauri::command]
pub fn settings_load(state: State<'_, AppState>) -> Value {
    json!({ "ok": true, "settings": state.settings_snapshot() })
}

#[tauri::command]
pub fn settings_save(app: AppHandle, state: State<'_, AppState>, args: Vec<Value>) -> Value {
    let patch = first_arg(&args);
    let next = settings::merge(&state.settings_snapshot(), &patch);
    if let Err(e) = settings::save_to_disk(&next) {
        eprintln!("[settings] 写入失败: {e}");
    }
    state.set_settings(next.clone());
    sync_theme_menu(&app, &next);
    let _ = app.emit("theme:set", json!([settings::theme_of(&next)]));
    json!({ "ok": true, "settings": next })
}

#[tauri::command]
pub fn app_version(app: AppHandle) -> Value {
    json!({ "ok": true, "version": app.package_info().version.to_string() })
}

#[tauri::command]
pub fn app_quit(app: AppHandle) -> Value {
    quit_app(&app);
    json!({ "ok": true })
}

/// 「稍后提醒 N 分钟」：写入到点时刻，由 notify 轮询穿透「同日不重复」再发一次。
/// 参数是分钟数，钳到 1..=120 —— 手滑传 0 会变成每分钟提醒一次，传天文数字等于永不提醒。
#[tauri::command]
pub fn snooze(app: AppHandle, args: Vec<Value>) -> Value {
    let minutes = first_arg(&args).as_f64().unwrap_or(10.0).round().clamp(1.0, 120.0) as u64;
    let until = crate::notify::now_ms() + minutes * 60_000;
    app.state::<AppState>().snooze_until_ms.store(until, Ordering::SeqCst);
    json!({ "ok": true, "untilMs": until })
}

// ---------------------------------------------------------------- 菜单动作

pub fn quit_app(app: &AppHandle) {
    crate::notify::stop_notify(app);
    app.exit(0);
}

pub fn open_data_dir(app: &AppHandle) {
    let _ = open_dir(app, paths::data_dir());
}

/// 在文件管理器里打开目录；目录不存在先建（失败直接返回，绝不把不存在的路径交给 open）
fn open_dir(app: &AppHandle, dir: PathBuf) -> Value {
    if !dir.exists() {
        let _ = std::fs::create_dir_all(&dir);
    }
    if !dir.exists() {
        return err(format!("数据目录不可用：{}", dir.display()));
    }
    use tauri_plugin_opener::OpenerExt;
    match app.opener().open_path(dir.to_string_lossy().to_string(), None::<&str>) {
        Ok(_) => json!({ "ok": true }),
        Err(e) => err(e),
    }
}

/// 「关于」正文。抽出来是为了能单测（备份目录与恢复入口必须出现在文案里，
/// 否则用户找不到备份文件在哪）。
pub fn about_detail() -> String {
    format!(
        "看板式待办管理工具\n数据目录：{}\n备份目录：{}\n（每天首次改动自动写一份，保留最新 10 份；恢复入口：文件 → 从备份恢复…）",
        paths::data_dir().display(),
        paths::backup_dir().display()
    )
}

pub fn show_about(app: &AppHandle) {
    let version = app.package_info().version.to_string();
    let _ = app
        .dialog()
        .message(format!("迷你待办 {version}\n\n{}", about_detail()))
        .title("关于 迷你待办")
        .kind(MessageDialogKind::Info)
        .blocking_show();
}

/// 主题单选点击：保存 + 同步勾选 + 广播
pub fn apply_theme_menu(app: &AppHandle, theme: &str) {
    let state = app.state::<AppState>();
    let next = settings::merge(&state.settings_snapshot(), &json!({ "theme": theme }));
    if let Err(e) = settings::save_to_disk(&next) {
        eprintln!("[settings] 写入失败: {e}");
    }
    state.set_settings(next.clone());
    sync_theme_menu(app, &next);
    let _ = app.emit("theme:set", json!([theme]));
}

pub fn sync_theme_menu(app: &AppHandle, settings_v: &Value) {
    let theme = settings::theme_of(settings_v);
    let state = app.state::<AppState>();
    // 先把句柄克隆出来再释放锁：菜单句柄是 Arc 句柄，clone 很便宜
    let items = state.theme_items.lock().clone();
    if let Some(items) = items {
        let _ = items[0].set_checked(theme == "system");
        let _ = items[1].set_checked(theme == "light");
        let _ = items[2].set_checked(theme == "dark");
    }
}

// ---------------------------------------------------------------- 导入 / 导出（菜单与 IPC 共用）

pub enum ImportOutcome {
    Canceled,
    Picked { store: Value, source: String, counts: Value },
}

/// 主进程侧导入：选文件（或 preset 直读）→ 归一化 → 先备份当前数据（只读，不落盘）
fn do_import(app: &AppHandle, preset: Option<PathBuf>) -> Result<ImportOutcome, String> {
    let Some(file) = pick_file_blocking(app, preset)? else {
        return Ok(ImportOutcome::Canceled);
    };
    let result = store_io::import_from_file(&file)?;
    // 备份在渲染层确认「替换/合并」之前发生（两者都会覆盖 todos.json，留档语义不变）
    let snapshot = app
        .state::<AppState>()
        .store_snapshot()
        .unwrap_or_else(normalize::empty_store);
    store_io::backup_if_due(&snapshot)?;
    Ok(ImportOutcome::Picked {
        store: result.store,
        source: result.source,
        counts: result.counts,
    })
}

/// 菜单触发的导入（在独立线程里跑：文件框是阻塞 API，不能占用主线程）
pub fn menu_import(app: &AppHandle, preset: Option<PathBuf>) {
    let app2 = app.clone();
    std::thread::spawn(move || match do_import(&app2, preset) {
        Ok(ImportOutcome::Canceled) => {}
        Ok(ImportOutcome::Picked { store, counts, .. }) => {
            let _ = app2.emit(
                "ui:open-dialog",
                json!(["import-choice", { "store": store, "counts": counts }]),
            );
        }
        Err(e) => {
            eprintln!("[menu] 导入失败: {e}");
            let _ = app2
                .dialog()
                .message(format!("文件无法解析为待办数据\n\n{e}"))
                .title("导入失败")
                .kind(MessageDialogKind::Error)
                .blocking_show();
        }
    });
}

/// 菜单触发的导出（独立线程；数据来自主进程快照）
pub fn menu_export(app: &AppHandle) {
    let app2 = app.clone();
    std::thread::spawn(move || {
        let store = app2.state::<AppState>().store_snapshot();
        let fail = |detail: String| {
            let _ = app2
                .dialog()
                .message(format!("无法写入目标文件\n\n{detail}"))
                .title("导出失败")
                .kind(MessageDialogKind::Error)
                .blocking_show();
        };
        let Some(store) = store else {
            // 绝不拿空数据导出：那会产出 0 任务的合法 JSON，用户以为备份成功了
            fail("数据尚未加载完成，请稍后重试".to_string());
            return;
        };
        match save_file_blocking(&app2, format!("todos-{}.json", dates::stamp_min())) {
            Ok(Some(path)) => match store_io::export_to_file(&path, &store) {
                Ok(()) => {
                    let _ = app2.emit("ui:open-dialog", json!(["exported", path.to_string_lossy()]));
                }
                Err(e) => fail(e),
            },
            Ok(None) => {}
            Err(e) => fail(e),
        }
    });
}

// ---------------------------------------------------------------- 对话框辅助

/// 选文件：preset 存在则零点击直读（菜单「导入旧版数据…」）；否则弹文件框并等待结果。
/// 用法约定：只在工作线程调用（内部用非阻塞 API + channel 等待，主线程调用不会死锁主线程）。
fn pick_file_blocking(app: &AppHandle, preset: Option<PathBuf>) -> Result<Option<PathBuf>, String> {
    if let Some(p) = preset {
        if !p.exists() {
            // 菜单入口要的是零点击：不存在必须立刻说清原因，而不是当成「无法解析」
            return Err(format!(
                "未找到旧版数据文件：{}。若已安装过旧版，请确认路径后再试",
                p.display()
            ));
        }
        return Ok(Some(p));
    }
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog()
        .file()
        .set_title("导入数据")
        .add_filter("JSON 数据", &["json"])
        .add_filter("全部文件", &["*"])
        .pick_file(move |p| {
            let _ = tx.send(p);
        });
    let picked = rx
        .recv_timeout(Duration::from_secs(600))
        .map_err(|_| "等待文件选择超时".to_string())?;
    Ok(picked.and_then(|fp| fp.into_path().ok()))
}

fn save_file_blocking(app: &AppHandle, default_name: String) -> Result<Option<PathBuf>, String> {
    save_file_blocking_ext(app, "导出数据", default_name, "JSON 数据", &["json"])
}

/// 保存对话框：标题 / 默认文件名 / 过滤器由调用方给（JSON 导出与 Markdown·CSV 导出共用）。
/// 用法约定：只在工作线程调用（内部用非阻塞 API + channel 等待，主线程调用不会死锁主线程）。
fn save_file_blocking_ext(
    app: &AppHandle,
    title: &str,
    default_name: String,
    filter_name: &str,
    exts: &[&str],
) -> Result<Option<PathBuf>, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog()
        .file()
        .set_title(title)
        .set_file_name(default_name)
        .add_filter(filter_name, exts)
        .save_file(move |p| {
            let _ = tx.send(p);
        });
    let picked = rx
        .recv_timeout(Duration::from_secs(600))
        .map_err(|_| "等待文件选择超时".to_string())?;
    Ok(picked.and_then(|fp| fp.into_path().ok()))
}
