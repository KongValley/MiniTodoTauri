//! 托盘：关闭窗口 = 隐藏到托盘；退出只有「文件→退出」与「托盘右键→退出」两条路径。
//! 对应旧版 `src/main/lib/tray.ts`（文案逐字一致）。

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

use crate::state::AppState;
use crate::window::{show_window, toggle_window};

pub fn create_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "tray-show", "显示窗口", true, None::<&str>)?;
    let snooze = MenuItem::with_id(app, "tray-snooze", "稍后提醒 10 分钟", true, None::<&str>)?;
    let count = MenuItem::with_id(app, "tray-count", "今天 0 项待办", false, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "tray-quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &snooze, &count, &sep, &quit])?;

    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png"))?;
    let tray = TrayIconBuilder::with_id("tray")
        .icon(icon)
        .tooltip("迷你待办 · 今天 0 项")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "tray-show" => show_window(app),
            "tray-snooze" => {
                let _ = crate::commands::snooze(app.clone(), vec![serde_json::json!(10)]);
            }
            "tray-quit" => crate::commands::quit_app(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_window(tray.app_handle());
            }
        })
        .build(app)?;

    let state = app.state::<AppState>();
    *state.tray.lock() = Some(tray);
    *state.tray_count_item.lock() = Some(count);
    Ok(())
}

/// 刷新「今天 N 项待办」文本与 tooltip（数据变更后由命令层调用）
pub fn set_today_count(app: &AppHandle, n: usize) {
    let state = app.state::<AppState>();
    let count_item = state.tray_count_item.lock().clone();
    if let Some(item) = count_item {
        let _ = item.set_text(format!("今天 {n} 项待办"));
    }
    let tray = state.tray.lock().clone();
    if let Some(tray) = tray {
        let _ = tray.set_tooltip(Some(format!("迷你待办 · 今天 {n} 项")));
    }
}

pub fn tray_exists(app: &AppHandle) -> bool {
    app.state::<AppState>().tray.lock().is_some()
}
