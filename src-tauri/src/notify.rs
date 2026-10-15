//! 到期提醒：每分钟检查一次，到达 notifyAt 且当天未发过时统计「今天 + 逾期」的未完成任务数，
//! 大于 0 才发系统通知并记下日期（同日不重复发）。对应旧版 `src/main/lib/notify.ts`。

use std::sync::atomic::Ordering;
use std::time::Duration;

use serde_json::json;
use tauri::AppHandle;
use tauri::Manager;
use tauri_plugin_notification::NotificationExt;

use crate::state::AppState;
use crate::{dates, settings};

/// 通知支持探测。插件启用 `windows7-compat` 后在 Win7/8/10/11 都有可用实现
/// （内部按系统版本分流：Win7 走 legacy 通知，其余走系统 toast），因此恒为支持；
/// 与旧版 Electron 探测（Win7 上可能为 false）相比这里不会误报不支持。
pub fn detect_supported() -> bool {
    true
}

/// 触发条件（与旧版 tick 一致）：
/// notifyEnabled && supported && lastNotifiedDate != today && 'HH:mm' >= notifyAt && count > 0
pub fn should_notify(settings_v: &serde_json::Value, supported: bool, now_hm: &str, today: &str, count: usize) -> bool {
    settings::notify_enabled_of(settings_v)
        && supported
        && settings::last_notified_of(settings_v) != today
        && now_hm >= settings::notify_at_of(settings_v).as_str()
        && count > 0
}

/// 跑一次检查；返回是否发出了通知
pub fn run_tick(app: &AppHandle) -> bool {
    let state = app.state::<AppState>();
    let settings_v = state.settings_snapshot();
    let today = dates::today();
    let now = dates::now_hm();
    let count = state.due_count();
    if !should_notify(&settings_v, true, &now, &today, count) {
        return false;
    }
    let body = format!("今天有 {count} 项待办");
    match app.notification().builder().title("迷你待办").body(&body).show() {
        Ok(_) => {
            *state.last_notification_body.lock() = Some(body);
            let next = settings::merge(&settings_v, &json!({ "lastNotifiedDate": today }));
            let _ = settings::save_to_disk(&next);
            state.set_settings(next);
            true
        }
        Err(e) => {
            eprintln!("[notify] 发送失败: {e}");
            false
        }
    }
}

/// 启动轮询线程：立即跑一次，此后每 60 秒一次；`notify_stop` 置位即退出。
pub fn start_notify_loop(app: AppHandle) {
    if !detect_supported() {
        eprintln!("[notify] 平台不支持通知，不启动轮询");
        return;
    }
    let _ = run_tick(&app);
    std::thread::spawn(move || loop {
        for _ in 0..60 {
            if app.state::<AppState>().notify_stop.load(Ordering::SeqCst) {
                return;
            }
            std::thread::sleep(Duration::from_secs(1));
        }
        let _ = run_tick(&app);
    });
}

pub fn stop_notify(app: &AppHandle) {
    app.state::<AppState>().notify_stop.store(true, Ordering::SeqCst);
}
