//! 应用设置（主题 / 到期提醒），落在 `%APPDATA%\MiniTodoElectron\settings.json`。
//! 对应旧版 `src/main/lib/settings.ts`：任何字段缺失或非法都回退默认值，读失败不抛。

use std::fs;

use serde_json::{json, Map, Value};

use crate::paths;

pub fn default_settings() -> Value {
    json!({
        "theme": "system",
        "notifyEnabled": false,
        "notifyAt": "09:00",
        "lastNotifiedDate": ""
    })
}

fn digits2(s: &str) -> Option<u32> {
    if s.len() == 2 && s.bytes().all(|c| c.is_ascii_digit()) {
        s.parse().ok()
    } else {
        None
    }
}

/// `^([01]\d|2[0-3]):[0-5]\d$`
pub fn hhmm_valid(s: &str) -> bool {
    let b = s.as_bytes();
    if b.len() != 5 || b[2] != b':' {
        return false;
    }
    match (digits2(&s[0..2]), digits2(&s[3..5])) {
        (Some(h), Some(m)) => h < 24 && m < 60,
        _ => false,
    }
}

pub fn normalize(raw: &Value) -> Value {
    let o = raw.as_object();
    let theme = o
        .and_then(|m| m.get("theme"))
        .and_then(|v| v.as_str())
        .filter(|s| matches!(*s, "system" | "light" | "dark"))
        .unwrap_or("system")
        .to_string();
    let notify_enabled = o.and_then(|m| m.get("notifyEnabled")) == Some(&Value::Bool(true));
    let notify_at = o
        .and_then(|m| m.get("notifyAt"))
        .and_then(|v| v.as_str())
        .filter(|s| hhmm_valid(s))
        .unwrap_or("09:00")
        .to_string();
    let last = o
        .and_then(|m| m.get("lastNotifiedDate"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let mut m = Map::new();
    m.insert("theme".into(), Value::from(theme));
    m.insert("notifyEnabled".into(), Value::Bool(notify_enabled));
    m.insert("notifyAt".into(), Value::from(notify_at));
    m.insert("lastNotifiedDate".into(), Value::from(last));
    Value::Object(m)
}

/// 读盘；缺文件/解析失败用默认值（读失败只告警，不抛）
pub fn load_from_disk() -> Value {
    let file = paths::settings_path();
    if !file.exists() {
        return default_settings();
    }
    match fs::read_to_string(&file) {
        Ok(text) => match serde_json::from_str::<Value>(&text) {
            Ok(v) => normalize(&v),
            Err(err) => {
                eprintln!("[settings] 读取失败，使用默认设置: {err}");
                default_settings()
            }
        },
        Err(err) => {
            eprintln!("[settings] 读取失败，使用默认设置: {err}");
            default_settings()
        }
    }
}

/// 写盘（2 空格缩进）；失败只记日志并继续用内存值
pub fn save_to_disk(v: &Value) -> Result<(), String> {
    fs::create_dir_all(paths::data_dir()).map_err(|e| e.to_string())?;
    let text = serde_json::to_string_pretty(v).map_err(|e| e.to_string())?;
    fs::write(paths::settings_path(), text).map_err(|e| e.to_string())
}

/// 浅合并 patch 到当前值（patch 非对象视为空），再归一化 —— 对应 `normalize({...当前, ...patch})`
pub fn merge(current: &Value, patch: &Value) -> Value {
    let mut m = current.as_object().cloned().unwrap_or_default();
    if let Some(p) = patch.as_object() {
        for (k, v) in p {
            m.insert(k.clone(), v.clone());
        }
    }
    normalize(&Value::Object(m))
}

pub fn theme_of(v: &Value) -> String {
    v.get("theme").and_then(|x| x.as_str()).unwrap_or("system").to_string()
}

pub fn notify_enabled_of(v: &Value) -> bool {
    v.get("notifyEnabled") == Some(&Value::Bool(true))
}

pub fn notify_at_of(v: &Value) -> String {
    v.get("notifyAt").and_then(|x| x.as_str()).unwrap_or("09:00").to_string()
}

pub fn last_notified_of(v: &Value) -> String {
    v.get("lastNotifiedDate").and_then(|x| x.as_str()).unwrap_or("").to_string()
}
