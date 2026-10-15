//! 路径常量。与旧版 `src/main/lib/paths.ts` 逐字一致：
//! 数据目录沿用 `%APPDATA%\MiniTodoElectron`（用户数据无缝延续），`TODO_DATA_DIR` 覆盖（冒烟/基准用）。

use std::path::PathBuf;

/// `%APPDATA%`（Roaming）。Windows 上必存在；缺失时退回当前目录并告警，不崩。
pub fn appdata_dir() -> PathBuf {
    match std::env::var_os("APPDATA") {
        Some(v) if !v.is_empty() => PathBuf::from(v),
        _ => {
            eprintln!("[paths] APPDATA 未设置，退回当前目录");
            PathBuf::from(".")
        }
    }
}

pub fn data_dir() -> PathBuf {
    if let Some(v) = std::env::var_os("TODO_DATA_DIR") {
        if !v.is_empty() {
            return PathBuf::from(v);
        }
    }
    appdata_dir().join("MiniTodoElectron")
}

pub fn store_path() -> PathBuf {
    data_dir().join("todos.json")
}

pub fn settings_path() -> PathBuf {
    data_dir().join("settings.json")
}

pub fn backup_dir() -> PathBuf {
    data_dir().join("backups")
}

/// 旧版 C# 应用的数据文件（一次性导入用）
pub fn old_store_path() -> PathBuf {
    appdata_dir().join("MiniTodo").join("todos.json")
}
