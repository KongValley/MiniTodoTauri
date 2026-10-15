//! 迷你待办 —— Tauri 宿主入口。启动顺序对应旧版 `src/main/index.ts`。

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod dates;
mod menu;
mod metrics;
mod normalize;
mod notify;
mod paths;
mod scan;
mod seed;
mod settings;
mod smoke;
mod state;
mod store_io;
mod tray;
mod window;

#[cfg(test)]
mod tests;

use std::sync::atomic::Ordering;

use tauri::Manager;
use tauri_plugin_notification::NotificationExt;

/// Win7 包在 exe 同目录带 `webview2-runtime/`（固定版 109），用官方环境变量指给 WebView2 loader；
/// 安装版与 zip 绿色版同一机制。找不到目录时不设置 —— 走系统 WebView2（Win10/11 自带）。
fn prepare_webview2_runtime() {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let rt = dir.join("webview2-runtime");
            if rt.is_dir() {
                std::env::set_var("WEBVIEW2_BROWSER_EXECUTABLE_FOLDER", &rt);
            }
        }
    }
}

/// 加载数据与设置；首次运行写入示例数据（写失败兜住：不中断启动，改为一次性告警）
fn init_state(app: &tauri::AppHandle) {
    let state = app.state::<state::AppState>();
    let loaded = store_io::load_store();
    state.set_store(loaded.store.clone());
    state.set_settings(settings::load_from_disk());
    if !paths::store_path().exists() {
        match serde_json::to_string(&loaded.store) {
            Ok(text) => {
                if let Err(e) = store_io::save_store(text.as_bytes()) {
                    let msg = format!("示例数据写入失败：{e}。数据目录不可写，改动不会被保存。");
                    eprintln!("[startup] {msg}");
                    state.set_startup_warning(msg);
                }
            }
            Err(e) => eprintln!("[startup] 序列化示例数据失败: {e}"),
        }
    }
}

fn main() {
    prepare_webview2_runtime();

    // 冒烟注入：让保存真的失败（验证「保存失败」提示与状态栏标记会送达用户，step28）
    if std::env::var("TODO_SMOKE_SAVE_FAIL").as_deref() == Ok("1") {
        store_io::set_force_save_fail(true);
    }

    let app = tauri::Builder::default()
        // 单实例插件必须最先注册：重复双击时新进程退出，并把已有窗口唤到最前
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            window::show_window(app);
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .manage(state::AppState::new())
        .invoke_handler(tauri::generate_handler![
            commands::store_load,
            commands::store_save,
            commands::store_import,
            commands::store_export,
            commands::store_open_dir,
            commands::settings_load,
            commands::settings_save,
            commands::app_version,
            commands::app_quit,
            smoke::smoke_report,
        ])
        .on_menu_event(|app, event| menu::on_menu_event(app, event.id().as_ref()))
        .on_page_load(|webview, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                window::on_page_load_finished(webview.app_handle());
            }
        })
        .on_window_event(|win, event| {
            if win.label() != "main" {
                return;
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // 关闭 = 隐藏到托盘；真正退出走「文件→退出」/托盘「退出」（app.exit 不触发本事件）
                api.prevent_close();
                let _ = win.hide();
                let app = win.app_handle();
                if !smoke::is_smoke_mode() {
                    let state = app.state::<state::AppState>();
                    if !state.tray_hint_shown.swap(true, Ordering::SeqCst) {
                        let _ = app
                            .notification()
                            .builder()
                            .title("迷你待办")
                            .body("已最小化到托盘，右键托盘图标可退出")
                            .show();
                    }
                }
            }
        })
        .setup(|app| {
            let handle = app.handle().clone();
            init_state(&handle);
            tray::create_tray(&handle)?;
            let app_menu = menu::build_app_menu(&handle)?;
            app.set_menu(app_menu)?;
            #[cfg(windows)]
            window::install_crash_watchdog(&handle);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|_app, _event| {});
}
