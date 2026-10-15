//! 应用菜单。对应旧版 `src/main/lib/menu.ts` 的条目与行为。
//! 说明：旧版是 autoHideMenuBar（按 Alt 才显示），Tauri/muda 的窗口菜单常显 —— 记为已知差异。

use serde_json::json;
use tauri::menu::{CheckMenuItemBuilder, Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager};

use crate::commands;
use crate::settings;
use crate::state::AppState;

pub fn build_app_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    // 文件
    let file = SubmenuBuilder::new(app, "文件")
        .text("file-import-old", "导入旧版数据…")
        .text("file-import-json", "导入 JSON…")
        .text("file-export", "导出数据…")
        .separator()
        .text("file-open-dir", "打开数据目录")
        .separator()
        .text("file-quit", "退出")
        .build()?;

    // 视图（看板/列表带快捷键；主题三单选）
    let theme = settings::theme_of(&app.state::<AppState>().settings_snapshot());
    let theme_sys =
        CheckMenuItemBuilder::with_id("theme-system", "跟随系统").checked(theme == "system").build(app)?;
    let theme_light =
        CheckMenuItemBuilder::with_id("theme-light", "浅色").checked(theme == "light").build(app)?;
    let theme_dark =
        CheckMenuItemBuilder::with_id("theme-dark", "深色").checked(theme == "dark").build(app)?;

    let view = SubmenuBuilder::new(app, "视图")
        .item(&MenuItemBuilder::with_id("view-board", "看板").accelerator("Ctrl+1").build(app)?)
        .item(&MenuItemBuilder::with_id("view-list", "列表").accelerator("Ctrl+2").build(app)?)
        .separator()
        .item(&theme_sys)
        .item(&theme_light)
        .item(&theme_dark)
        .separator()
        .text("view-settings", "设置…")
        .build()?;

    // 帮助
    let help = SubmenuBuilder::new(app, "帮助")
        .text("help-keys", "快捷键")
        .text("help-about", "关于")
        .build()?;

    let menu = MenuBuilder::new(app).items(&[&file, &view, &help]).build()?;

    // 记住主题项句柄：settings:save / 菜单切换后同步勾选
    let state = app.state::<AppState>();
    *state.theme_items.lock() = Some([theme_sys, theme_light, theme_dark]);
    Ok(menu)
}

pub fn on_menu_event(app: &AppHandle, id: &str) {
    match id {
        "file-import-old" => commands::menu_import(app, Some(crate::paths::old_store_path())),
        "file-import-json" => commands::menu_import(app, None),
        "file-export" => commands::menu_export(app),
        "file-open-dir" => commands::open_data_dir(app),
        "file-quit" => commands::quit_app(app),
        "view-board" => {
            let _ = app.emit("ui:set-board", json!([true]));
        }
        "view-list" => {
            let _ = app.emit("ui:set-board", json!([false]));
        }
        "view-settings" => {
            let _ = app.emit("ui:open-dialog", json!(["settings"]));
        }
        "help-keys" => {
            let _ = app.emit("ui:open-dialog", json!(["help"]));
        }
        "help-about" => commands::show_about(app),
        id if id.starts_with("theme-") => commands::apply_theme_menu(app, &id["theme-".len()..]),
        _ => {}
    }
}
