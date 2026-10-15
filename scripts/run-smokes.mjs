// 依次运行全部冒烟脚本（每步独立数据目录，避免互相污染导致抖动）。
// 与 Electron 版同构：env 同名、MAIN_ASSERTIONS 断言表原样保留；
// 启动目标改为 Tauri 构建产物，`--user-data-dir` 参数不再需要（数据目录靠 TODO_DATA_DIR）。
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const appExe =
  process.env.TODO_APP_EXE ||
  join(root, 'src-tauri', 'target', 'x86_64-pc-windows-msvc', 'release', 'mini-todo.exe')
const tmpDir = join(root, 'tmp')
mkdirSync(tmpDir, { recursive: true })

const scripts = [
  'step1-shell.js',
  'step2-query.js',
  'step3-store.js',
  'step4-import.js',
  'step5-board.js',
  'step6-list.js',
  'step7-crud.js',
  'step8-subtask.js',
  'step9-drag.js',
  'step10-repeat.js',
  'step11-trash.js',
  'step12-theme.js',
  'step13-search.js',
  'step14-keymap.js',
  'step15-window.js',
  'step16-tray-notify.js',
  'step17-virtual.js',
  'step18-single-instance.js',
  'step19-delete-confirm.js',
  'step20-card-menu.js',
  'step21-list-sort.js',
  'step22-import-merge.js',
  'step23-empty-state.js',
  'step24-jump-today.js',
  'step25-select-all.js',
  'step26-icons.js',
  'step27-renderer-crash.js',
  'step28-save-fail.js',
  'step29-sidebar-manage.js'
]

if (!existsSync(appExe)) {
  console.error(
    `缺少应用二进制 ${appExe}\n先运行：npm run build && cargo build --release --locked --target x86_64-pc-windows-msvc --manifest-path src-tauri/Cargo.toml`
  )
  process.exit(1)
}

// 单步脚本超时（毫秒）：默认 60s；拖拽步骤涉及多次布局重建，给更宽裕的上限
const STEP_TIMEOUTS = {
  'step9-drag.js': '120000',
  'step17-virtual.js': '120000'
}

// 注入渲染进程崩溃的步骤（主进程侧杀 WebView2 渲染进程，用来验证崩溃自愈）。
// 等待时间必须大于注入延迟 1200ms + 重载耗时，否则会在恢复完成前就收尾写结果。
const CRASH_PROBE = { 'step27-renderer-crash.js': { env: '1', settleMs: '4000' } }

// 注入保存失败（验证「保存失败」提示与状态栏标记真的送达用户）
const SAVE_FAIL_PROBE = { 'step28-save-fail.js': { env: '1', settleMs: '300' } }

// 主进程侧断言（mainChecks）：渲染层脚本无法观测的窗口/托盘/通知/单实例状态
const MAIN_ASSERTIONS = {
  'step15-window.js': (mc) => [
    ['窗口非无边框(原生标题栏)', mc.frameless === false],
    ['窗口标题', mc.title === '迷你待办'],
    ['最小尺寸', JSON.stringify(mc.minSize) === '[900,600]']
  ],
  'step16-tray-notify.js': (mc) => [
    ['托盘已创建', mc.trayExists === true],
    ['通知受支持', mc.notify && mc.notify.supported === true],
    ['通知已发出并记录日期', mc.notify && mc.notify.lastNotifiedDate.length === 10],
    ['通知内容含待办条数', mc.notify && /今天有 \d+ 项待办/.test(mc.notify.lastBody)],
    [
      '关闭 = 隐藏到托盘(不退出)',
      mc.closeProbe && mc.closeProbe.before === true && mc.closeProbe.afterVisible === false && mc.closeProbe.destroyed === false
    ]
  ],
  'step18-single-instance.js': (mc) => [
    ['本进程持有单实例锁', mc.singleInstance && mc.singleInstance.hasLock === true],
    ['窗口确实被隐藏(前置条件)', mc.singleInstance && mc.singleInstance.hiddenBefore === false],
    ['再次启动后窗口恢复可见', mc.singleInstance && mc.singleInstance.visibleAfter === true],
    ['置顶仅为打断前台锁定而临时开启,已交还', mc.singleInstance && mc.singleInstance.alwaysOnTopAfter === false]
  ],
  'step27-renderer-crash.js': (mc) => [
    ['崩溃后窗口仍在', mc.windowAlive === true],
    ['渲染进程崩溃被检测并自动重载', mc.rendererRecovered === true]
  ],
  'step28-save-fail.js': (mc) => [['注入的保存确实失败了(至少两次)', mc.saveFailures >= 2]]
}

let failed = 0
for (const script of scripts) {
  const name = script.replace(/\.js$/, '')
  const outFile = join(tmpDir, `smoke-${name}.json`)
  const dataDir = join(tmpDir, `data-${name}`)
  rmSync(outFile, { force: true })
  // 每步从干净数据目录开始，否则上一步留下的设置/数据会让断言不可复现
  rmSync(dataDir, { recursive: true, force: true })
  spawnSync(appExe, [], {
    cwd: root,
    env: {
      ...process.env,
      TODO_SMOKE: '1',
      TODO_SMOKE_SCRIPT: join('scripts', 'smoke', script),
      TODO_SMOKE_OUT: outFile,
      TODO_SMOKE_ROOT: root,
      TODO_DATA_DIR: dataDir,
      TODO_SMOKE_NOTIFY: name === 'step16-tray-notify' ? '1' : '0',
      TODO_SMOKE_CLOSE_PROBE: name === 'step16-tray-notify' ? '1' : '0',
      TODO_SMOKE_SINGLE_INSTANCE: name === 'step18-single-instance' ? '1' : '0',
      TODO_SMOKE_CRASH_PROBE: CRASH_PROBE[script]?.env ?? '0',
      TODO_SMOKE_SAVE_FAIL: SAVE_FAIL_PROBE[script]?.env ?? '0',
      TODO_SMOKE_SETTLE: SAVE_FAIL_PROBE[script]?.settleMs ?? CRASH_PROBE[script]?.settleMs ?? '800',
      TODO_SMOKE_TIMEOUT: STEP_TIMEOUTS[script] ?? '60000'
    },
    stdio: 'ignore'
  })
  let report = { ok: false, error: '未生成结果文件' }
  if (existsSync(outFile)) {
    try {
      report = JSON.parse(readFileSync(outFile, 'utf8'))
    } catch (err) {
      report = { ok: false, error: `结果文件解析失败:${String(err)}` }
    }
  }
  // 主进程侧断言：失败时把步骤整体判 FAIL
  const checks = MAIN_ASSERTIONS[script]
  if (report.ok && checks) {
    const failedChecks = checks(report.mainChecks ?? {})
      .filter(([, pass]) => !pass)
      .map(([label]) => label)
    if (failedChecks.length > 0) {
      report = { ok: false, error: `主进程断言失败: ${failedChecks.join(' / ')}` }
    }
  }
  if (!report.ok) failed++
  console.log(`${report.ok ? 'PASS' : 'FAIL'} ${name}${report.ok ? '' : ` - ${report.error}`}`)
}

console.log(failed === 0 ? `\n全部 ${scripts.length} 项冒烟通过` : `\n${failed}/${scripts.length} 项失败`)
process.exit(failed === 0 ? 0 : 1)
