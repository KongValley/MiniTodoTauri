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
    let (bytes, parsed) = match &payload {
        Value::String(s) => match serde_json::from_str::<Value>(s) {
            Ok(v) => (s.clone().into_bytes(), v),
            Err(e) => return err(format!("数据格式非法:{e}")),
        },
        other => match serde_json::to_string(other) {
            Ok(s) => (s.into_bytes(), other.clone()),
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
    state.set_store(parsed);
    // 托盘计数是副作用，不能因此把已成功的保存报成失败
    let count = state.due_count();
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

#[tauri::command]
pub fn store_open_dir(app: AppHandle) -> Value {
    open_data_dir_impl(&app)
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

// ---------------------------------------------------------------- 菜单动作

pub fn quit_app(app: &AppHandle) {
    crate::notify::stop_notify(app);
    app.exit(0);
}

pub fn open_data_dir(app: &AppHandle) {
    let _ = open_data_dir_impl(app);
}

fn open_data_dir_impl(app: &AppHandle) -> Value {
    let dir = paths::data_dir();
    // 目录不存在先建；仍失败直接返回，绝不把不存在的路径交给 open
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

pub fn show_about(app: &AppHandle) {
    let version = app.package_info().version.to_string();
    let detail = format!("看板式待办管理工具\n数据目录：{}", paths::data_dir().display());
    let _ = app
        .dialog()
        .message(format!("迷你待办 {version}\n\n{detail}"))
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
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog()
        .file()
        .set_title("导出数据")
        .set_file_name(default_name)
        .add_filter("JSON 数据", &["json"])
        .save_file(move |p| {
            let _ = tx.send(p);
        });
    let picked = rx
        .recv_timeout(Duration::from_secs(600))
        .map_err(|_| "等待文件选择超时".to_string())?;
    Ok(picked.and_then(|fp| fp.into_path().ok()))
}
