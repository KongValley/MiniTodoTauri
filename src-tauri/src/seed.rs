//! 首次运行写入的示例数据（照抄旧版 `seedStore()`，`src/shared/store-ops.ts:138-202`）：
//! 2 分组 / 5 清单 / 12 条任务，最后一条在收集箱（lid 为空）。

use serde_json::{Map, Value};

use crate::dates::{add_days, today};
use crate::normalize::{new_id, now_ms, ACTIVE, LIST_COLORS};

pub fn seed_store() -> Value {
    let gid_w = new_id();
    let gid_l = new_id();

    let groups = Value::Array(vec![
        {
            let mut m = Map::new();
            m.insert("id".into(), Value::from(gid_w.clone()));
            m.insert("name".into(), Value::from("工作"));
            m.insert("order".into(), Value::from(0));
            Value::Object(m)
        },
        {
            let mut m = Map::new();
            m.insert("id".into(), Value::from(gid_l.clone()));
            m.insert("name".into(), Value::from("生活"));
            m.insert("order".into(), Value::from(1));
            Value::Object(m)
        },
    ]);

    let names = ["内容生产", "待办事务", "生活杂事", "健康", "装修"];
    let gids = [&gid_w, &gid_w, &gid_l, &gid_l, &gid_l];
    let mut lists = Vec::new();
    for (i, name) in names.iter().enumerate() {
        let mut m = Map::new();
        m.insert("id".into(), Value::from(new_id()));
        m.insert("gid".into(), Value::from(gids[i].clone()));
        m.insert("name".into(), Value::from(*name));
        m.insert("color".into(), Value::from(LIST_COLORS[i]));
        m.insert("order".into(), Value::from(i as i64));
        lists.push(Value::Object(m));
    }
    let lids: Vec<String> = lists
        .iter()
        .map(|l| l.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string())
        .collect();

    let t = today();
    // (清单下标, 标题, 备注, 日期, 优先级)
    let rows: [(usize, &str, &str, String, i64); 12] = [
        (0, "AI任务管理视频（本周发布）", "本周发布", t.clone(), 1),
        (1, "整理本周工作周报", "", t.clone(), 2),
        (1, "填项目总结文档（周四前交）", "", add_days(&t, 1), 1),
        (3, "补牙进度回看：这周挂号有进展吗", "", add_days(&t, 1), 2),
        (2, "给父母买中秋礼物（寄到家）", "", add_days(&t, 1), 1),
        (4, "去物业报备装修（工办）", "", add_days(&t, 2), 1),
        (3, "查县医院就诊时间安排", "", add_days(&t, 2), 1),
        (0, "国庆后要发的文章（初稿）", "", add_days(&t, 2), 2),
        (4, "装修方案二次确认", "带上上周的报价单", add_days(&t, 3), 2),
        (2, "整理旧照片备份", "", add_days(&t, 4), 3),
        (0, "研究剪辑软件方案", "", add_days(&t, 5), 3),
        (usize::MAX, "随手记：下周要交的材料清单", "", String::new(), 2),
    ];

    let now = now_ms();
    let mut todos = Vec::new();
    for (i, (lid_idx, title, note, date, prio)) in rows.iter().enumerate() {
        let mut m = Map::new();
        m.insert("id".into(), Value::from(new_id()));
        m.insert(
            "lid".into(),
            Value::from(if *lid_idx == usize::MAX { String::new() } else { lids[*lid_idx].clone() }),
        );
        m.insert("title".into(), Value::from(*title));
        m.insert("note".into(), Value::from(*note));
        m.insert("date".into(), Value::from(date.clone()));
        m.insert("prio".into(), Value::from(*prio));
        m.insert("status".into(), Value::from(ACTIVE));
        m.insert("seq".into(), Value::from(i as i64 + 1));
        m.insert("order".into(), Value::from(0));
        m.insert("subtasks".into(), Value::Array(vec![]));
        {
            let mut r = Map::new();
            r.insert("kind".into(), Value::from("none"));
            m.insert("repeat".into(), Value::Object(r));
        }
        m.insert("createdAt".into(), Value::from(now + i as i64));
        m.insert("doneAt".into(), Value::Null);
        todos.push(Value::Object(m));
    }

    let mut store = Map::new();
    store.insert("version".into(), Value::from(2));
    store.insert("groups".into(), groups);
    store.insert("lists".into(), Value::Array(lists));
    store.insert("todos".into(), Value::Array(todos));
    Value::Object(store)
}
