//! 全局状态（tauri `manage` 注入）。

use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize};

use parking_lot::Mutex;
use serde_json::Value;

pub struct AppState {
    /// 主进程侧的数据快照（托盘计数与菜单导出共用），随每次 load/save/import 更新
    pub store: Mutex<Option<Value>>,
    /// 归一化后的设置（内存缓存）
    pub settings: Mutex<Value>,
    /// 保存失败次数（渲染层观测不到主进程错误，这个计数供 mainChecks 断言）
    pub save_failures: AtomicUsize,
    /// 渲染进程连续崩溃次数（成功加载后归零；超过上限不再自动重载）
    pub renderer_crashes: AtomicUsize,
    /// 「崩过又加载成功」标记，粘住不动，供冒烟主进程侧断言
    pub renderer_recovered: AtomicBool,
    /// 最近一次发出的通知正文（mainChecks 断言用）
    pub last_notification_body: Mutex<Option<String>>,
    /// 通知轮询的停止旗标（退出时置位）
    pub notify_stop: AtomicBool,
    /// 「稍后提醒」到点时刻（epoch ms，0 = 未设置）。到点后穿透「同日不重复」，再发一次后清零。
    /// i686 支持 64 位原子（cmpxchg8b），Win7 32 位包也能用。
    pub snooze_until_ms: AtomicU64,
    /// 托盘句柄与「今天 N 项待办」文本项（刷新计数用）
    pub tray: Mutex<Option<tauri::tray::TrayIcon<tauri::Wry>>>,
    pub tray_count_item: Mutex<Option<tauri::menu::MenuItem<tauri::Wry>>>,
    /// 视图菜单的主题单选项（保存设置后同步勾选）
    pub theme_items: Mutex<Option<[tauri::menu::CheckMenuItem<tauri::Wry>; 3]>>,
    /// 启动阶段产生的一次性告警（种子写失败等），首个页面加载完成后发给渲染层
    startup_warning: Mutex<String>,
    /// 「已最小化到托盘」提示只发一次
    pub tray_hint_shown: AtomicBool,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            store: Mutex::new(None),
            settings: Mutex::new(crate::settings::default_settings()),
            save_failures: AtomicUsize::new(0),
            renderer_crashes: AtomicUsize::new(0),
            renderer_recovered: AtomicBool::new(false),
            last_notification_body: Mutex::new(None),
            notify_stop: AtomicBool::new(false),
            snooze_until_ms: AtomicU64::new(0),
            tray: Mutex::new(None),
            tray_count_item: Mutex::new(None),
            theme_items: Mutex::new(None),
            startup_warning: Mutex::new(String::new()),
            tray_hint_shown: AtomicBool::new(false),
        }
    }

    pub fn set_startup_warning(&self, msg: String) {
        *self.startup_warning.lock() = msg;
    }

    pub fn take_startup_warning(&self) -> String {
        std::mem::take(&mut *self.startup_warning.lock())
    }

    pub fn store_snapshot(&self) -> Option<Value> {
        self.store.lock().clone()
    }

    pub fn set_store(&self, v: Value) {
        *self.store.lock() = Some(v);
    }

    /// 接管一版新的 store（`park`）并就地扫描出结果。
    ///
    /// 为什么不用 `set_store` + `due_count`：`due_count` 走 `store_snapshot()`，那是整棵
    /// Value 的深拷贝（1 MB 载荷实测约 13 ms）。这里把值 move 进锁内、借用着扫描，
    /// "先接管再统计"的语序不变，但一次拷贝都不做。
    pub fn store_scan<T>(&self, f: impl FnOnce(&Value) -> T, fallback: T, park: Option<Value>) -> T {
        let mut guard = self.store.lock();
        if let Some(value) = park {
            *guard = Some(value);
        }
        match guard.as_ref() {
            Some(s) => f(s),
            None => fallback,
        }
    }

    pub fn settings_snapshot(&self) -> Value {
        self.settings.lock().clone()
    }

    pub fn set_settings(&self, v: Value) {
        *self.settings.lock() = v;
    }

    pub fn due_count(&self) -> usize {
        // 借用扫描,不走 store_snapshot():后者每次调用都深拷贝整棵树
        self.store_scan(crate::scan::count_due, 0, None)
    }
}
