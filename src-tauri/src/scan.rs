//! 主进程侧对 store 快照的轻量扫描（托盘计数 / 到期提醒共用）。
//! 语义与旧版 `countDue`（`src/shared/query.ts:40-45`）逐字一致：
//! status === ACTIVE && date !== '' && date <= today。

use serde_json::Value;

pub fn count_due(store: &Value) -> usize {
    let Some(todos) = store.get("todos").and_then(|v| v.as_array()) else {
        return 0;
    };
    let t0 = crate::dates::today();
    todos
        .iter()
        .filter(|t| {
            let active = t.get("status").and_then(|v| v.as_f64()) == Some(0.0);
            let date = t.get("date").and_then(|v| v.as_str()).unwrap_or("");
            active && !date.is_empty() && date <= t0.as_str()
        })
        .count()
}
