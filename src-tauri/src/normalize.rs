//! `normalizeStore` 的逐条移植（旧版 `src/shared/store-ops.ts:99-136`）——
//! 唯一的数据信任边界：导入旧数据 / 损坏文件恢复两条路径都过它。
//! 输出字段与顺序和 TS 版一致（serde_json 开 preserve_order），便于 fixture 对照测试。

use rand::Rng;
use serde_json::{Map, Value};

pub const ACTIVE: i64 = 0;
const DONE: i64 = 1;
const DROPPED: i64 = 2;
const TRASH: i64 = 3;

const REPEAT_KINDS: [&str; 5] = ["none", "daily", "weekly", "monthly", "weekday"];

/// 可选清单配色（与旧版 types.ts 的 LIST_COLORS 一致）
pub const LIST_COLORS: [&str; 7] = [
    "#3A7AFE", "#7C5CFF", "#F2A33C", "#3C9954", "#12A5B8", "#E8705F", "#8A8F98",
];

/// normalize 的非法颜色回退色 —— 注意不是调色板首色（旧版即如此）
const INVALID_LIST_COLOR: &str = "#8A8F98";

/// 10 位十六进制 id（与旧版 Store.NewId 一致）
pub fn new_id() -> String {
    let mut rng = rand::thread_rng();
    let mut s = String::with_capacity(10);
    for _ in 0..10 {
        s.push(char::from_digit(rng.gen_range(0..16), 16).unwrap_or('0'));
    }
    s
}

pub fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn empty_store() -> Value {
    let mut m = Map::new();
    m.insert("version".into(), Value::from(2));
    m.insert("groups".into(), Value::Array(vec![]));
    m.insert("lists".into(), Value::Array(vec![]));
    m.insert("todos".into(), Value::Array(vec![]));
    Value::Object(m)
}

fn as_str(v: Option<&Value>) -> String {
    v.and_then(|x| x.as_str()).map(str::to_string).unwrap_or_default()
}

fn finite_f64(v: Option<&Value>) -> Option<f64> {
    v.and_then(|x| x.as_f64()).filter(|f| f.is_finite())
}

/// 数值字段：有限数保留原值（clone），否则用回退值
fn num_keep_or(v: Option<&Value>, fallback: Value) -> Value {
    match v {
        Some(x) if finite_f64(Some(x)).is_some() => x.clone(),
        _ => fallback,
    }
}

fn hex6(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 7 && b[0] == b'#' && b[1..].iter().all(|c| c.is_ascii_hexdigit())
}

fn normalize_subtask(raw: Option<&Value>) -> Value {
    let o = raw.and_then(|v| v.as_object());
    let get = |k: &str| o.and_then(|m| m.get(k));
    let mut m = Map::new();
    let id = as_str(get("id"));
    m.insert(
        "id".into(),
        Value::from(if id.is_empty() { new_id() } else { id }),
    );
    m.insert("title".into(), Value::from(as_str(get("title"))));
    m.insert("done".into(), Value::Bool(get("done") == Some(&Value::Bool(true))));
    Value::Object(m)
}

fn normalize_group(raw: Option<&Value>, index: usize) -> Value {
    let o = raw.and_then(|v| v.as_object());
    let get = |k: &str| o.and_then(|m| m.get(k));
    let mut m = Map::new();
    let id = as_str(get("id"));
    m.insert("id".into(), Value::from(if id.is_empty() { new_id() } else { id }));
    m.insert("name".into(), Value::from(as_str(get("name"))));
    m.insert("order".into(), num_keep_or(get("order"), Value::from(index as i64)));
    Value::Object(m)
}

fn normalize_list(raw: Option<&Value>, index: usize) -> Value {
    let o = raw.and_then(|v| v.as_object());
    let get = |k: &str| o.and_then(|m| m.get(k));
    let mut m = Map::new();
    let id = as_str(get("id"));
    m.insert("id".into(), Value::from(if id.is_empty() { new_id() } else { id }));
    m.insert("gid".into(), Value::from(as_str(get("gid"))));
    m.insert("name".into(), Value::from(as_str(get("name"))));
    let color = as_str(get("color"));
    m.insert(
        "color".into(),
        Value::from(if hex6(&color) { color } else { INVALID_LIST_COLOR.to_string() }),
    );
    m.insert("order".into(), num_keep_or(get("order"), Value::from(index as i64)));
    Value::Object(m)
}

fn normalize_todo(raw: Option<&Value>, list_ids: &std::collections::HashSet<String>, fallback_seq: usize) -> Value {
    let o = raw.and_then(|v| v.as_object());
    let get = |k: &str| o.and_then(|m| m.get(k));

    let prio_raw = finite_f64(get("prio")).unwrap_or(2.0);
    let prio = if prio_raw == 1.0 || prio_raw == 2.0 || prio_raw == 3.0 { prio_raw as i64 } else { 2 };
    let status_raw = finite_f64(get("status")).unwrap_or(ACTIVE as f64);
    let status = if status_raw == DONE as f64 || status_raw == DROPPED as f64 || status_raw == TRASH as f64 {
        status_raw as i64
    } else {
        ACTIVE
    };

    let lid = as_str(get("lid"));
    let repeat_raw = get("repeat").and_then(|v| v.as_object());
    let kind = repeat_raw
        .and_then(|m| m.get("kind"))
        .and_then(|v| v.as_str())
        .unwrap_or("none");
    let kind = if REPEAT_KINDS.contains(&kind) { kind } else { "none" };
    let anchor = finite_f64(repeat_raw.and_then(|m| m.get("anchorDay")));

    let date = get("date").and_then(|v| v.as_str()).unwrap_or("");
    let date = if crate::dates::is_date(date) { date.to_string() } else { String::new() };

    let mut m = Map::new();
    let id = as_str(get("id"));
    m.insert("id".into(), Value::from(if id.is_empty() { new_id() } else { id }));
    m.insert(
        "lid".into(),
        Value::from(if list_ids.contains(&lid) { lid } else { String::new() }),
    );
    m.insert("title".into(), Value::from(as_str(get("title"))));
    m.insert("note".into(), Value::from(as_str(get("note"))));
    m.insert("date".into(), Value::from(date));
    m.insert("prio".into(), Value::from(prio));
    m.insert("status".into(), Value::from(status));
    m.insert("seq".into(), num_keep_or(get("seq"), Value::from(fallback_seq as i64)));
    m.insert("order".into(), num_keep_or(get("order"), Value::from(0)));
    m.insert(
        "subtasks".into(),
        match get("subtasks").and_then(|v| v.as_array()) {
            Some(arr) => Value::Array(arr.iter().map(|x| normalize_subtask(Some(x))).collect()),
            None => Value::Array(vec![]),
        },
    );
    {
        let mut r = Map::new();
        r.insert("kind".into(), Value::from(kind));
        if kind == "monthly" {
            if let Some(a) = anchor {
                if (1.0..=31.0).contains(&a) {
                    r.insert("anchorDay".into(), repeat_raw.and_then(|m| m.get("anchorDay")).cloned().unwrap_or(Value::from(a as i64)));
                }
            }
        }
        m.insert("repeat".into(), Value::Object(r));
    }
    m.insert("createdAt".into(), num_keep_or(get("createdAt"), Value::from(now_ms())));
    m.insert(
        "doneAt".into(),
        num_keep_or(get("doneAt"), Value::Null),
    );
    Value::Object(m)
}

fn claim(id: String, seen: &mut std::collections::HashSet<String>) -> String {
    if seen.insert(id.clone()) {
        id
    } else {
        let fresh = new_id();
        seen.insert(fresh.clone());
        fresh
    }
}

/// 归一化任意来源的数据为合法 v2 store。顶层未知键丢弃；三集合各自按 id 去重（重复换新 id，不丢条目）。
pub fn normalize_store(raw: &Value) -> Value {
    let get = |k: &str| raw.as_object().and_then(|m| m.get(k));

    let mut seen_groups = std::collections::HashSet::new();
    let mut seen_lists = std::collections::HashSet::new();
    let mut seen_todos = std::collections::HashSet::new();

    let groups: Vec<Value> = match get("groups").and_then(|v| v.as_array()) {
        Some(arr) => arr
            .iter()
            .enumerate()
            .map(|(i, g)| {
                let mut n = normalize_group(Some(g), i);
                let id = claim(as_str(n.get("id")), &mut seen_groups);
                if let Some(m) = n.as_object_mut() {
                    m.insert("id".into(), Value::from(id));
                }
                n
            })
            .collect(),
        None => vec![],
    };

    let lists: Vec<Value> = match get("lists").and_then(|v| v.as_array()) {
        Some(arr) => arr
            .iter()
            .enumerate()
            .map(|(i, l)| {
                let mut n = normalize_list(Some(l), i);
                let id = claim(as_str(n.get("id")), &mut seen_lists);
                if let Some(m) = n.as_object_mut() {
                    m.insert("id".into(), Value::from(id));
                }
                n
            })
            .collect(),
        None => vec![],
    };

    let list_ids: std::collections::HashSet<String> = lists
        .iter()
        .map(|l| as_str(l.get("id")))
        .collect();

    let todos: Vec<Value> = match get("todos").and_then(|v| v.as_array()) {
        Some(arr) => arr
            .iter()
            .enumerate()
            .map(|(i, t)| {
                let mut n = normalize_todo(Some(t), &list_ids, i + 1);
                let id = claim(as_str(n.get("id")), &mut seen_todos);
                if let Some(m) = n.as_object_mut() {
                    m.insert("id".into(), Value::from(id));
                }
                n
            })
            .collect(),
        None => vec![],
    };

    let mut m = Map::new();
    m.insert("version".into(), Value::from(2));
    m.insert("groups".into(), Value::Array(groups));
    m.insert("lists".into(), Value::Array(lists));
    m.insert("todos".into(), Value::Array(todos));
    Value::Object(m)
}
