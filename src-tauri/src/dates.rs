//! 日期工具（本地时区）。逐一对应旧版 `src/shared/dates.ts`。
//! 一律本地时区；禁止用 UTC 换算（旧版注释：new Date().toISOString() 会偏时区）。

use chrono::{Datelike, Local, NaiveDate, Timelike};

fn pad2(n: u32) -> String {
    format!("{:02}", n)
}

/// 'yyyy-MM-dd'（本地时区）
pub fn today() -> String {
    fmt(Local::now().date_naive())
}

fn fmt(d: NaiveDate) -> String {
    format!("{}-{}-{}", d.year(), pad2(d.month()), pad2(d.day()))
}

/// 严格解析 'yyyy-MM-dd' 且日期真实存在（拒绝 2026-2-3 / 2026-13-01 / 2026-02-30）
pub fn parse(s: &str) -> Option<NaiveDate> {
    let b = s.as_bytes();
    if b.len() != 10 {
        return None;
    }
    let digits = |r: &[u8]| r.iter().all(|c| c.is_ascii_digit());
    if !digits(&b[0..4]) || b[4] != b'-' || !digits(&b[5..7]) || b[7] != b'-' || !digits(&b[8..10]) {
        return None;
    }
    let y: i32 = s[0..4].parse().ok()?;
    let m: u32 = s[5..7].parse().ok()?;
    let d: u32 = s[8..10].parse().ok()?;
    if !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return None;
    }
    NaiveDate::from_ymd_opt(y, m, d)
}

/// 严格校验 'yyyy-MM-dd'（与旧版 isDate 等价）
pub fn is_date(s: &str) -> bool {
    parse(s).is_some()
}

/// 相对日期加减；非法输入按今天处理（与旧版 P.Date 一致）
pub fn add_days(s: &str, n: i64) -> String {
    let base = parse(s).unwrap_or_else(|| Local::now().date_naive());
    match base.checked_add_signed(chrono::Duration::days(n)) {
        Some(d) => fmt(d),
        None => fmt(base),
    }
}

/// 当前本地时间 'HH:mm'
pub fn now_hm() -> String {
    let t = Local::now();
    format!("{}:{}", pad2(t.hour()), pad2(t.minute()))
}

/// 备份文件名用的时间戳 'YYYYMMDD-HHmmss'（本地时区）
pub fn stamp() -> String {
    let t = Local::now();
    format!(
        "{}{}{}-{}{}{}",
        t.year(),
        pad2(t.month()),
        pad2(t.day()),
        pad2(t.hour()),
        pad2(t.minute()),
        pad2(t.second())
    )
}

/// 导出默认文件名用的时间戳 'YYYYMMDD-HHmm'（旧版 ipc.ts 的 stampName）
pub fn stamp_min() -> String {
    let t = Local::now();
    format!(
        "{}{}{}-{}{}",
        t.year(),
        pad2(t.month()),
        pad2(t.day()),
        pad2(t.hour()),
        pad2(t.minute())
    )
}
