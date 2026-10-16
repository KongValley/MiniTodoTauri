//! 宿主侧单元测试：normalize fixture 对照、seed 结构、扫描/设置/通知规则、日期与 IO 规则。
//! 全部通过 `cargo test` 运行（`npm run test:rust`）。

use std::collections::HashSet;
use std::path::PathBuf;

use parking_lot::Mutex;
use serde_json::{json, Value};

use crate::{dates, normalize, paths, scan, seed, settings, store_io};

fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests").join("fixtures").join("normalize")
}

fn collect_input_ids(input: &Value) -> HashSet<String> {
    let mut ids = HashSet::new();
    fn walk(v: &Value, ids: &mut HashSet<String>) {
        match v {
            Value::Array(a) => a.iter().for_each(|x| walk(x, ids)),
            Value::Object(o) => {
                for (k, val) in o {
                    if k == "id" {
                        if let Some(s) = val.as_str() {
                            ids.insert(s.to_string());
                        }
                    }
                    walk(val, ids);
                }
            }
            _ => {}
        }
    }
    walk(input, &mut ids);
    ids
}

/// 掩码：新生成的 id → "__new__"；由缺失 createdAt 补出的值 → "__now__"
fn mask(input: &Value, output: &Value) -> Value {
    let input_ids = collect_input_ids(input);
    let mut out = output.clone();
    fn walk(v: &mut Value, ids: &HashSet<String>) {
        match v {
            Value::Array(a) => a.iter_mut().for_each(|x| walk(x, ids)),
            Value::Object(o) => {
                for (k, val) in o.iter_mut() {
                    if k == "id" {
                        if let Some(s) = val.as_str() {
                            if !ids.contains(s) {
                                *val = Value::from("__new__");
                            }
                            continue;
                        }
                    }
                    walk(val, ids);
                }
            }
            _ => {}
        }
    }
    walk(&mut out, &input_ids);

    let input_todos = input.get("todos").and_then(|v| v.as_array());
    if let Some(out_todos) = out.get_mut("todos").and_then(|v| v.as_array_mut()) {
        for (i, t) in out_todos.iter_mut().enumerate() {
            let src_has_created = input_todos
                .and_then(|a| a.get(i))
                .and_then(|s| s.get("createdAt"))
                .and_then(|c| c.as_f64())
                .map(|f| f.is_finite())
                .unwrap_or(false);
            if !src_has_created {
                if let Some(o) = t.as_object_mut() {
                    o.insert("createdAt".into(), Value::from("__now__"));
                }
            }
        }
    }
    out
}

#[test]
fn normalize_matches_fixtures() {
    let dir = fixtures_dir();
    let entries = std::fs::read_dir(&dir).unwrap_or_else(|e| panic!("读取 {} 失败: {e}", dir.display()));
    let mut checked = 0;
    for entry in entries.flatten() {
        let path = entry.path();
        let name = path.file_name().and_then(|s| s.to_str()).unwrap_or_default().to_string();
        if !name.ends_with(".input.json") {
            continue;
        }
        let stem = name.trim_end_matches(".input.json");
        let expected_path = dir.join(format!("{stem}.expected.json"));
        let input: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        let expected: Value =
            serde_json::from_str(&std::fs::read_to_string(&expected_path).unwrap()).unwrap();
        let got = mask(&input, &normalize::normalize_store(&input));
        assert_eq!(got, expected, "fixture 不一致: {stem}");
        checked += 1;
    }
    assert!(checked >= 15, "fixture 数量异常: {checked}");
}

#[test]
fn seed_structure() {
    let s = seed::seed_store();
    assert_eq!(s.get("version").and_then(|v| v.as_i64()), Some(2));
    let groups = s.get("groups").and_then(|v| v.as_array()).unwrap();
    let lists = s.get("lists").and_then(|v| v.as_array()).unwrap();
    let todos = s.get("todos").and_then(|v| v.as_array()).unwrap();
    assert_eq!(groups.len(), 2);
    assert_eq!(lists.len(), 5);
    assert_eq!(todos.len(), 12);
    let unscheduled = todos
        .iter()
        .filter(|t| t.get("date").and_then(|v| v.as_str()) == Some(""))
        .count();
    assert_eq!(unscheduled, 1, "恰好 1 条未排期");
    assert_eq!(
        todos.last().and_then(|t| t.get("lid")).and_then(|v| v.as_str()),
        Some(""),
        "最后一条在收集箱"
    );
    // 归一化应保持不变（seed 自身合法）
    assert_eq!(normalize::normalize_store(&s), s);
}

#[test]
fn count_due_scan() {
    let today = dates::today();
    let yesterday = dates::add_days(&today, -1);
    let tomorrow = dates::add_days(&today, 1);
    let s = json!({
        "todos": [
            { "id": "a", "status": 0, "date": today },
            { "id": "b", "status": 0, "date": yesterday },
            { "id": "c", "status": 0, "date": tomorrow },
            { "id": "d", "status": 0, "date": "" },
            { "id": "e", "status": 1, "date": today },
            { "id": "f", "status": 3, "date": yesterday },
            { "id": "g", "date": yesterday },
            { "id": "h", "status": 0 }
        ]
    });
    assert_eq!(scan::count_due(&s), 2);
    assert_eq!(scan::count_due(&json!({})), 0);
}

#[test]
fn settings_normalize_and_hhmm() {
    assert!(settings::hhmm_valid("09:00"));
    assert!(settings::hhmm_valid("23:59"));
    assert!(!settings::hhmm_valid("24:00"));
    assert!(!settings::hhmm_valid("9:00"));
    assert!(!settings::hhmm_valid("09:60"));
    assert!(!settings::hhmm_valid(""));
    let d = settings::default_settings();
    assert_eq!(d.get("theme").and_then(|v| v.as_str()), Some("system"));
    assert_eq!(d.get("notifyAt").and_then(|v| v.as_str()), Some("09:00"));
    let n = settings::normalize(&json!({
        "theme": "neon", "notifyEnabled": 1, "notifyAt": "25:00", "lastNotifiedDate": 5, "x": 1
    }));
    assert_eq!(n.get("theme").and_then(|v| v.as_str()), Some("system"));
    assert_eq!(n.get("notifyEnabled"), Some(&Value::Bool(false)));
    assert_eq!(n.get("notifyAt").and_then(|v| v.as_str()), Some("09:00"));
    assert_eq!(n.get("lastNotifiedDate").and_then(|v| v.as_str()), Some(""));
    assert!(n.get("x").is_none(), "未知键丢弃");
    // 视图记忆与窗口几何：脏值一律回退（null 坐标 + w=0 表示「没存过」）
    assert_eq!(n.get("lastView").and_then(|v| v.as_str()), Some("week7"), "缺失回退 week7");
    assert_eq!(settings::win_of(&n), None, "缺失 win 视为没存过");
    let v = settings::normalize(&json!({
        "lastView": "list:7eaee681d4",
        "win": { "x": 300, "y": 200, "w": 1000, "h": 700, "max": true }
    }));
    assert_eq!(v.get("lastView").and_then(|x| x.as_str()), Some("list:7eaee681d4"));
    assert_eq!(settings::win_of(&v), Some((300, 200, 1000, 700, true)));
    let bad_view = settings::normalize(&json!({ "lastView": "List:先删库!" }));
    assert_eq!(bad_view.get("lastView").and_then(|x| x.as_str()), Some("week7"), "非法字符集回退");
    let small = settings::normalize(&json!({ "win": { "x": 0, "y": 0, "w": 10, "h": 10 } }));
    assert_eq!(settings::win_of(&small), None, "过小尺寸视为没存过");
    let no_pos = settings::normalize(&json!({ "win": { "w": 1000, "h": 700 } }));
    assert_eq!(settings::win_of(&no_pos), None, "缺坐标视为没存过");
    let merged_win = settings::merge(&v, &json!({ "win": { "x": 10, "y": 20, "w": 900, "h": 600, "max": false } }));
    assert_eq!(settings::win_of(&merged_win), Some((10, 20, 900, 600, false)), "合法值原样保留");
    let merged = settings::merge(&d, &json!({ "theme": "dark" }));
    assert_eq!(merged.get("theme").and_then(|v| v.as_str()), Some("dark"));
    assert_eq!(merged.get("notifyAt").and_then(|v| v.as_str()), Some("09:00"));
}

#[test]
fn notify_trigger_rules() {
    let anchor = json!({ "theme": "system", "notifyEnabled": true, "notifyAt": "09:00", "lastNotifiedDate": "" });
    use crate::notify::should_notify;
    assert!(should_notify(&anchor, true, "09:00", "2026-10-15", 1, false));
    assert!(should_notify(&anchor, true, "23:59", "2026-10-15", 2, false));
    assert!(!should_notify(&anchor, true, "08:59", "2026-10-15", 1, false), "未到点");
    assert!(!should_notify(&anchor, true, "09:00", "2026-10-15", 0, false), "没有待办");
    assert!(!should_notify(&anchor, false, "09:00", "2026-10-15", 1, false), "不支持");
    let disabled = json!({ "theme": "system", "notifyEnabled": false, "notifyAt": "09:00", "lastNotifiedDate": "" });
    assert!(!should_notify(&disabled, true, "09:00", "2026-10-15", 1, false), "开关未开");
    let already = json!({ "theme": "system", "notifyEnabled": true, "notifyAt": "09:00", "lastNotifiedDate": "2026-10-15" });
    assert!(!should_notify(&already, true, "09:00", "2026-10-15", 1, false), "同日不重复");
    assert!(should_notify(&already, true, "09:00", "2026-10-16", 1, false), "次日可再发");
    // 「稍后提醒」到点后穿透「同日不重复」；没到点/开关关着照样不响
    assert!(should_notify(&already, true, "09:00", "2026-10-15", 1, true), "稍后提醒到点要再发一次");
    assert!(!should_notify(&disabled, true, "09:00", "2026-10-15", 1, true), "开关关着，稍后提醒也不发");
    assert!(!should_notify(&already, true, "08:59", "2026-10-15", 1, true), "未到提醒时间，稍后提醒也不发");
}

#[test]
fn dates_local() {
    let t = dates::today();
    assert_eq!(t.len(), 10);
    assert!(dates::is_date(&t), "today() 必须是严格日期: {t}");
    assert!(!dates::is_date("2026-2-3"));
    assert!(!dates::is_date("2026-13-01"));
    assert!(!dates::is_date("2026-02-30"));
    assert_eq!(dates::add_days("2026-01-31", 1), "2026-02-01");
    assert_eq!(dates::add_days("2026-01-31", -31), "2025-12-31");
    assert_eq!(dates::add_days("bad", 0), dates::today(), "非法输入按今天处理");
    let hm = dates::now_hm();
    assert_eq!(hm.len(), 5);
    assert_eq!(&hm[2..3], ":");
    let st = dates::stamp();
    assert_eq!(st.len(), 15);
    let sm = dates::stamp_min();
    assert_eq!(sm.len(), 13);
}

// 环境相关测试串行执行（TODO_DATA_DIR 是进程级环境变量）
static IO_LOCK: Mutex<()> = Mutex::new(());

#[test]
fn store_io_rules() {
    let _guard = IO_LOCK.lock();
    let dir = std::env::temp_dir().join(format!("mini-todo-test-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::env::set_var("TODO_DATA_DIR", &dir);

    // 无文件 → 种子
    let loaded = store_io::load_store();
    assert_eq!(loaded.warning, "");
    assert_eq!(loaded.store.get("version").and_then(|v| v.as_i64()), Some(2));

    // 原子写 + 原样字节
    let bytes = serde_json::to_string(&loaded.store).unwrap();
    store_io::save_store(bytes.as_bytes()).unwrap();
    assert_eq!(std::fs::read_to_string(paths::store_path()).unwrap(), bytes);

    // 损坏文件 → 改名隔离 + 告警 + 种子
    std::fs::write(paths::store_path(), "{oops").unwrap();
    let loaded2 = store_io::load_store();
    assert!(loaded2.warning.contains("数据文件无法解析"), "告警文案: {}", loaded2.warning);
    assert!(loaded2.warning.contains("原文件已保留为"), "告警文案: {}", loaded2.warning);
    let corrupt = std::fs::read_dir(&dir)
        .unwrap()
        .flatten()
        .filter(|e| e.file_name().to_string_lossy().starts_with("todos.json.corrupt-"))
        .count();
    assert_eq!(corrupt, 1, "损坏文件应改名留档");
    // 渲染层的 store:load 再取一次告警
    let cached = store_io::consume_load_warning();
    assert!(cached.contains("数据文件无法解析"));
    assert_eq!(store_io::consume_load_warning(), "", "取走即清空");

    // 备份：每天一份 + 命名
    let created = store_io::backup_if_due(&loaded.store).unwrap();
    assert!(created.is_some(), "首次应创建备份");
    let again = store_io::backup_if_due(&loaded.store).unwrap();
    assert!(again.is_none(), "同日不重复备份");
    let backups: Vec<String> = std::fs::read_dir(paths::backup_dir())
        .unwrap()
        .flatten()
        .map(|e| e.file_name().to_string_lossy().to_string())
        .collect();
    assert_eq!(backups.len(), 1);
    assert!(crate::store_io::is_backup_name_for_test(&backups[0]), "备份命名: {}", backups[0]);

    // 损坏副本限量：>5 时只留最新 5
    for i in 0..7 {
        std::fs::write(dir.join(format!("todos.json.corrupt-2026010{}-00000{}", i, i)), "x").unwrap();
    }
    store_io::load_store(); // 触发 prune（文件已是有效 JSON 时也会 prune? 只有损坏分支 prune）
    // 直接构造损坏触发 prune
    std::fs::write(paths::store_path(), "{oops").unwrap();
    let _ = store_io::load_store();
    let n = std::fs::read_dir(&dir)
        .unwrap()
        .flatten()
        .filter(|e| e.file_name().to_string_lossy().starts_with("todos.json.corrupt-"))
        .count();
    assert!(n <= 5, "损坏副本应限量 5，实际 {n}");

    // 冒烟注入：强制保存失败
    store_io::set_force_save_fail(true);
    let e = store_io::save_store(b"{}").unwrap_err();
    assert!(e.contains("冒烟注入"));
    store_io::set_force_save_fail(false);

    // 形状校验
    assert!(store_io::assert_store_shape(&json!({ "groups": [], "lists": [], "todos": [] })).is_ok());
    assert!(store_io::assert_store_shape(&json!({ "groups": 1, "lists": [], "todos": [] })).is_err());
    assert!(store_io::assert_store_shape(&json!("x")).is_err());

    let _ = std::fs::remove_dir_all(&dir);
    std::env::remove_var("TODO_DATA_DIR");
}
