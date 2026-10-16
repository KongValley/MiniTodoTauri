//! 迷你待办 —— Tauri 宿主入口。启动顺序对应旧版 `src/main/index.ts`。

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod bootlog;
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

/// WebView2 运行时选择：
/// - 包内带 `webview2-runtime/`（固定版 109），Win7 上系统没有可用运行时 → 用包内这份；
/// - 系统已装 WebView2（Win10/11，或装过运行时的老系统）→ 优先用系统版（更新、持续有安全更新）。
/// 判定只看标准安装目录，不查注册表、不联网；两处都不存在时不设置环境变量，交给 loader 自己报错。
fn prepare_webview2_runtime() {
    let rt = match std::env::current_exe() {
        Ok(exe) => match exe.parent() {
            Some(dir) => dir.join("webview2-runtime"),
            None => return,
        },
        Err(_) => return,
    };
    if rt.is_dir() && !system_webview2_present() {
        std::env::set_var("WEBVIEW2_BROWSER_EXECUTABLE_FOLDER", &rt);
    }
}

/// 系统是否已安装 WebView2（三处标准安装目录下任一存在 msedgewebview2.exe）
fn system_webview2_present() -> bool {
    ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"].iter().any(|var| {
        std::env::var(var)
            .ok()
            .filter(|s| !s.is_empty())
            .map(|root| {
                std::path::PathBuf::from(root)
                    .join("Microsoft")
                    .join("EdgeWebView")
                    .join("Application")
            })
            .map(|app| {
                std::fs::read_dir(&app)
                    .map(|rd| rd.flatten().any(|e| e.path().join("msedgewebview2.exe").is_file()))
                    .unwrap_or(false)
            })
            .unwrap_or(false)
    })
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
    bootlog::init();
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
            // 老机器上 WebView2/Edge 内核初始化要好几秒：等到首帧再 show 会让用户以为「点了没反应」。
            // 立刻显示（窗口背景色 + 骨架屏同色系，不白闪），内容随后自然填上。
            window::show_window(&handle);
            bootlog::mark("window_shown");
            // 稳态内存分解：15s 后一次（冒烟/基准跑不到 15s，不写 steady 行属正常）
            std::thread::spawn(|| {
                std::thread::sleep(std::time::Duration::from_secs(15));
                bootlog::snapshot("steady");
            });
            bootlog::mark("setup_done");
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|_app, _event| {});
}
