//! todos.json 读写与备份。原子写 + 损坏文件改名 + 每次变更即落盘（文件 <100 KB，不做防抖）。
//! 对应旧版 `src/main/lib/store.ts`，文案与边界逐条一致。

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use parking_lot::Mutex;
use serde_json::{json, Value};

use crate::dates;
use crate::normalize::normalize_store;
use crate::paths;
use crate::seed::seed_store;

/// 备份保留份数（超出按修改时间删最旧）
const BACKUP_KEEP: usize = 10;
/// 损坏文件隔离副本保留份数
const CORRUPT_KEEP: usize = 5;

/// 冒烟注入：强制下一次保存失败（step28 用）
static FORCE_SAVE_FAIL: AtomicBool = AtomicBool::new(false);
/// 主进程启动那次 loadStore 消费掉的损坏告警，渲染层的 store:load 再取一次
static LAST_WARNING: Mutex<String> = Mutex::new(String::new());

pub struct LoadResult {
    pub store: Value,
    pub warning: String,
}

pub struct ImportResult {
    pub store: Value,
    pub source: String,
    pub counts: Value,
}

pub fn set_force_save_fail(v: bool) {
    FORCE_SAVE_FAIL.store(v, Ordering::SeqCst);
}

fn file_name(p: &Path) -> String {
    p.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default()
}

fn counts_of(store: &Value) -> Value {
    let n = |k: &str| -> usize {
        store.get(k).and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0)
    };
    json!({ "groups": n("groups"), "lists": n("lists"), "todos": n("todos") })
}

pub fn load_store() -> LoadResult {
    let file = paths::store_path();
    if !file.exists() {
        return LoadResult { store: seed_store(), warning: String::new() };
    }
    let parsed = fs::read_to_string(&file)
        .map_err(|e| e.to_string())
        .and_then(|text| serde_json::from_str::<Value>(&text).map_err(|e| e.to_string()));
    match parsed {
        Ok(v) => LoadResult { store: normalize_store(&v), warning: String::new() },
        Err(err) => {
            // 绝不静默覆盖：损坏文件改名留档，用户可自行找回
            let quarantined = PathBuf::from(format!(
                "{}.corrupt-{}",
                file.to_string_lossy(),
                dates::stamp()
            ));
            let mut warning =
                format!("数据文件无法解析({err})，已改用示例数据");
            if fs::rename(&file, &quarantined).is_ok() {
                warning.push_str(&format!("；原文件已保留为 {}", file_name(&quarantined)));
            } else {
                warning.push_str("；且无法重命名原文件，请手动备份后再继续");
            }
            eprintln!("[store] 数据文件损坏: {err}");
            *LAST_WARNING.lock() = warning.clone();
            prune_corrupt();
            LoadResult { store: seed_store(), warning }
        }
    }
}

/// 取走并清空上一次 loadStore 的损坏告警（渲染层 store:load 用）
pub fn consume_load_warning() -> String {
    std::mem::take(&mut *LAST_WARNING.lock())
}

fn is_corrupt_name(name: &str) -> bool {
    // ^todos\.json\.corrupt-\d{8}-\d{6}$
    let Some(rest) = name.strip_prefix("todos.json.corrupt-") else {
        return false;
    };
    let b = rest.as_bytes();
    b.len() == 15 && b[8] == b'-' && b[..8].iter().all(u8::is_ascii_digit) && b[9..].iter().all(u8::is_ascii_digit)
}

fn is_backup_name(name: &str) -> bool {
    // ^todos-\d{8}-\d{6}\.json$
    if !name.starts_with("todos-") || !name.ends_with(".json") {
        return false;
    }
    let mid = &name[6..name.len() - 5];
    let b = mid.as_bytes();
    b.len() == 15 && b[8] == b'-' && b[..8].iter().all(u8::is_ascii_digit) && b[9..].iter().all(u8::is_ascii_digit)
}

#[cfg(test)]
pub(crate) fn is_backup_name_for_test(name: &str) -> bool {
    is_backup_name(name)
}

fn mtime_desc(paths: &mut Vec<PathBuf>) {
    paths.sort_by_key(|p| std::cmp::Reverse(fs::metadata(p).and_then(|m| m.modified()).ok()));
}

/// 隔离副本限量：按 mtime 倒序保留最新 CORRUPT_KEEP 份，删更旧的（错误只记日志）
fn prune_corrupt() {
    let dir = paths::data_dir();
    let Ok(rd) = fs::read_dir(&dir) else { return };
    let mut stale: Vec<PathBuf> = rd
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| is_corrupt_name(&file_name(p)))
        .collect();
    mtime_desc(&mut stale);
    for f in stale.into_iter().skip(CORRUPT_KEEP) {
        if let Err(e) = fs::remove_file(&f) {
            eprintln!("[store] 清理损坏文件副本失败: {e}");
        }
    }
}

/// 原子落盘。调用方保证内容合法（命令层 assert 形状 / 导入侧 normalize）。
/// 收到的字节原样写入（与渲染层 JSON.stringify 结果字节一致）。
pub fn save_store(bytes: &[u8]) -> Result<(), String> {
    if FORCE_SAVE_FAIL.load(Ordering::SeqCst) {
        return Err("磁盘写入失败（冒烟注入）".to_string());
    }
    let file = paths::store_path();
    fs::create_dir_all(paths::data_dir()).map_err(|e| e.to_string())?;
    let tmp = PathBuf::from(format!("{}.tmp", file.to_string_lossy()));
    {
        let mut f = fs::File::create(&tmp).map_err(|e| e.to_string())?;
        f.write_all(bytes).map_err(|e| e.to_string())?;
    }
    fs::rename(&tmp, &file).map_err(|e| e.to_string())?;
    Ok(())
}

/// 全部备份文件，按 mtime 倒序（最新在前）。「从备份恢复」列表与每天去重都读它。
pub fn list_backups() -> Vec<PathBuf> {
    let dir = paths::backup_dir();
    let Ok(rd) = fs::read_dir(&dir) else { return vec![] };
    let mut v: Vec<PathBuf> = rd
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| is_backup_name(&file_name(p)))
        .collect();
    mtime_desc(&mut v);
    v
}

fn write_pretty(path: &Path, value: &Value) -> Result<(), String> {
    let text = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    fs::write(path, text).map_err(|e| e.to_string())
}

/// 每天最多备份一份；超出 BACKUP_KEEP 份时删最旧（写入前先 mkdir，无论是否新建都修剪）
pub fn backup_if_due(store: &Value) -> Result<Option<PathBuf>, String> {
    let dir = paths::backup_dir();
    // 只扫一次目录:此前「是否已备份」与「修剪旧备份」各扫一遍,而这条路径每次保存都要走
    let mut existing = list_backups();
    let stamp = dates::stamp();
    let today_tag = stamp[..8].to_string();
    let already_today = existing.iter().any(|p| {
        let name = file_name(p);
        name.len() >= 14 && name[6..14] == today_tag
    });

    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut created = None;
    if !already_today {
        let path = dir.join(format!("todos-{stamp}.json"));
        write_pretty(&path, store)?;
        // 刚写的是最新一份,直接插到列表头(下接修剪),不必再跑一次 read_dir
        existing.insert(0, path.clone());
        created = Some(path);
    }

    for stale in existing.into_iter().skip(BACKUP_KEEP) {
        fs::remove_file(stale).map_err(|e| e.to_string())?;
    }
    Ok(created)
}

/// 读入并归一化外部 JSON；调用方确认后才落盘（此函数只读）
pub fn import_from_file(file: &Path) -> Result<ImportResult, String> {
    let text = fs::read_to_string(file).map_err(|e| e.to_string())?;
    let parsed: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let store = normalize_store(&parsed);
    let counts = counts_of(&store);
    Ok(ImportResult { store, source: file.to_string_lossy().to_string(), counts })
}

pub fn export_to_file(file: &Path, store: &Value) -> Result<(), String> {
    write_pretty(file, store)
}

/// 落盘前的轻量形状校验：确认顶层结构可用，不做逐条归一化（旧版 assertStoreShape）
pub fn assert_store_shape(v: &Value) -> Result<(), String> {
    let Some(o) = v.as_object() else {
        return Err("数据格式非法:不是对象".to_string());
    };
    for k in ["groups", "lists", "todos"] {
        if !o.get(k).map(|x| x.is_array()).unwrap_or(false) {
            return Err(format!("数据格式非法:{k} 不是数组"));
        }
    }
    Ok(())
}
