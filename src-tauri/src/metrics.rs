//! 进程树内存/进程数统计（冒烟报告与性能基准用）——替代旧版主进程的 app.getAppMetrics()。
//! 口径：本进程 + 全部后代进程（WebView2 的子进程为 msedgewebview2.exe）。

#[cfg(windows)]
mod imp {
    use std::collections::HashMap;

    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };
    use windows_sys::Win32::System::ProcessStatus::{GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS};
    use windows_sys::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};

    pub struct ProcMem {
        pub name: String,
        pub private_mb: f64,
    }

    pub struct Metrics {
        pub self_pid: u32,
        pub pids: Vec<u32>,
        pub total_rss_mb: f64,
        pub total_private_mb: f64,
        pub proc_count: usize,
        pub procs: Vec<ProcMem>,
    }

    /// PROCESSENTRY32W.szExeFile 是 NUL 结尾的 UTF-16（basename）
    fn exe_name(buf: [u16; 260]) -> String {
        let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        String::from_utf16_lossy(&buf[..end])
    }

    fn parent_map() -> HashMap<u32, (u32, String)> {
        let mut map = HashMap::new();
        unsafe {
            let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if snap == INVALID_HANDLE_VALUE {
                return map;
            }
            let mut entry: PROCESSENTRY32W = std::mem::zeroed();
            entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
            if Process32FirstW(snap, &mut entry) != 0 {
                loop {
                    map.insert(entry.th32ProcessID, (entry.th32ParentProcessID, exe_name(entry.szExeFile)));
                    if Process32NextW(snap, &mut entry) == 0 {
                        break;
                    }
                }
            }
            CloseHandle(snap);
        }
        map
    }

    fn mem_of(pid: u32) -> Option<(u64, u64)> {
        unsafe {
            let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if h.is_null() {
                return None;
            }
            let mut c: PROCESS_MEMORY_COUNTERS = std::mem::zeroed();
            c.cb = std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32;
            let ok = GetProcessMemoryInfo(h, &mut c, c.cb);
            CloseHandle(h);
            if ok == 0 {
                None
            } else {
                Some((c.WorkingSetSize as u64, c.PagefileUsage as u64))
            }
        }
    }

    pub fn collect() -> Metrics {
        let me = std::process::id();
        let parents = parent_map();
        let mut tree: Vec<u32> = vec![me];
        loop {
            let mut added = false;
            for (&pid, &(ppid, _)) in parents.iter() {
                if !tree.contains(&pid) && tree.contains(&ppid) {
                    tree.push(pid);
                    added = true;
                }
            }
            if !added {
                break;
            }
        }
        let round1 = |bytes: u64| (bytes as f64 / 1024.0 / 1024.0 * 10.0).round() / 10.0;
        let mut rss = 0u64;
        let mut private = 0u64;
        let mut procs = Vec::new();
        for &pid in &tree {
            if let Some((w, p)) = mem_of(pid) {
                rss += w;
                private += p;
                let name = parents.get(&pid).map(|(_, n)| n.clone()).unwrap_or_default();
                procs.push(ProcMem { name, private_mb: round1(p) });
            }
        }
        Metrics {
            self_pid: me,
            proc_count: tree.len(),
            pids: tree,
            total_rss_mb: round1(rss),
            total_private_mb: round1(private),
            procs,
        }
    }
}

#[cfg(windows)]
pub use imp::collect;
