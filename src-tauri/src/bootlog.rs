//! 启动 / 内存 / 崩溃诊断日志：写 <数据目录>/perf.log，一次启动追加若干行，超过 64 KiB 保留最后 100 行。
//! release 无控制台，这是目标机上唯一的证据来源；写不进去也不能影响功能。
use std::io::Write;
use std::path::Path;
use std::sync::OnceLock;
use std::time::Instant;

/// t0：init() 时刻固定，进程内最早可知的计时起点。
/// 用 OnceLock 而非 LazyLock：rust-toolchain 锁 1.77（LazyLock 1.80 才稳定）。
static T0: OnceLock<Instant> = OnceLock::new();
const MAX_BYTES: u64 = 64 * 1024;
const KEEP_LINES: usize = 100;

/// 必须在 main() 第一行调用：t0 = 进程内最早可知时刻（不含 OS 装载 exe 的时间）
pub fn init() {
    let _ = T0.set(Instant::now());
    append("boot start");
}

pub fn mark(label: &str) {
    append(label);
}

/// 内存分解：进程树总私有提交 / 工作集 / 进程数 + 按进程名（basename）聚合
pub fn snapshot(label: &str) {
    let m = crate::metrics::collect();
    let mut agg: std::collections::BTreeMap<&str, f64> = std::collections::BTreeMap::new();
    for p in &m.procs {
        *agg.entry(p.name.as_str()).or_insert(0.0) += p.private_mb;
    }
    let per: Vec<String> = agg.iter().map(|(n, v)| format!("{n}={v:.0}MB")).collect();
    append(&format!(
        "mem {label} private={:.0}MB ws={:.0}MB procs={} {}",
        m.total_private_mb,
        m.total_rss_mb,
        m.proc_count,
        per.join(" ")
    ));
}

fn append(line: &str) {
    let base = T0.get().copied().unwrap_or_else(Instant::now);
    let text = format!(
        "{} +{}ms {}\n",
        chrono::Local::now().format("%Y-%m-%d %H:%M:%S"),
        base.elapsed().as_millis(),
        line
    );
    let _ = write_line(&text);
}

fn write_line(text: &str) -> std::io::Result<()> {
    let path = crate::paths::data_dir().join("perf.log");
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?; // 数据目录被删过也能记
    }
    rotate_if_big(&path);
    std::fs::OpenOptions::new().create(true).append(true).open(&path)?.write_all(text.as_bytes())
}

fn rotate_if_big(path: &Path) {
    if std::fs::metadata(path).map(|m| m.len() > MAX_BYTES).unwrap_or(false) {
        if let Ok(text) = std::fs::read_to_string(path) {
            let keep: Vec<&str> = text.lines().rev().take(KEEP_LINES).collect();
            let body = keep.into_iter().rev().collect::<Vec<_>>().join("\n");
            let _ = std::fs::write(path, format!("{body}\n"));
        }
    }
}
