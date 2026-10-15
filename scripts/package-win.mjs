// 单架构打包：node scripts/package-win.mjs <win7-ia32|win7-x64>
// 只出 Win7 双架构（32/64）：包内自带 WebView2 109 固定版运行时 —— Win7 上直接可用，
// Win10/11 上装同一套包也能跑（检测到系统 WebView2 时优先用系统版，见 src-tauri/src/main.rs）。
// 各组合 → release/<中文目录>/，含安装包（NSIS exe）与绿色版（zip，解压即用），文件名自明。
// Tauri 版与 Electron 版的差异：绿色版 zip 由本脚本组 staging 目录后压缩（Tauri 无 zip 目标）；
// Win7 组合额外把 WebView2 109 固定版运行时打进包内（exe 同目录的 webview2-runtime/）。
import { execFileSync, execSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// 随 Win7 分发目录附带的补丁安装说明（写入 前置补丁/安装说明.txt）；文案与 Electron 版一致
const PATCH_README = `Windows 7 前置补丁(适用于本目录中的安装包与绿色版)

前提:Windows 7 SP1。
安装顺序:先装 KB4490628,再装 KB4474419;KB2533623、KB2670838 顺序不限。双击 .msu 逐个安装,提示重启就重启。

- KB2533623  强烈建议 — 提供 DLL 安全加载 API(SetDefaultDllDirectories);缺失时应用按旧式加载运行,老系统若报「无法定位程序输入点 SetDefaultDllDirectories 于动态链接库 KERNEL32.dll」补装它即可
- KB2670838  推荐 — Windows 7 平台更新(DirectWrite 1.1);未装时页面文字可能渲染模糊
- KB4490628  推荐 — 维护堆栈(KB4474419 的前置)
- KB4474419  推荐 — SHA-2 代码签名支持;企业内网更新分发与签名校验链路需要

官方下载地址(缺失时补取;下载页选 Windows 7 / 6.1、32 位或 64 位):
- KB2533623:https://support.microsoft.com/kb/2533623 (支持页,内含 x86/x64 下载入口)
- KB2670838:https://www.microsoft.com/en-us/download/details.aspx?id=36805
- KB4490628:https://www.catalog.update.microsoft.com/Search.aspx?q=KB4490628
- KB4474419:https://www.catalog.update.microsoft.com/Search.aspx?q=KB4474419

本应用完全离线运行,不联网、不校验代码签名;补上这些补丁可消除老系统上的兼容与渲染问题。
补丁来自 Microsoft 官方渠道,均带 Microsoft 数字签名;Win10 及以上系统不需要这些补丁。
`

const combos = {
  'win7-ia32': {
    label: 'Win7-32位',
    triple: 'i686-pc-windows-msvc',
    overlay: 'src-tauri/tauri.win7-ia32.conf.json',
    runtime: 'webview2-runtime-x86',
    patchArch: 'x86'
  },
  'win7-x64': {
    label: 'Win7-64位',
    triple: 'x86_64-pc-windows-msvc',
    overlay: 'src-tauri/tauri.win7-x64.conf.json',
    runtime: 'webview2-runtime-x64',
    patchArch: 'x64'
  }
}

const combo = process.argv[2]
if (!(combo in combos)) {
  console.error(`用法：node scripts/package-win.mjs <${Object.keys(combos).join('|')}>`)
  process.exit(1)
}
const cfg = combos[combo]
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const releaseDir = join(root, 'release')
const outDir = join(releaseDir, cfg.label)
const targetDir = join(root, 'src-tauri', 'target', cfg.triple, 'release')

function run(cmd, args) {
  execFileSync(cmd, args, { cwd: root, stdio: 'inherit' })
}

// 1) 版本一致性（产物文件名内嵌版本号，两处不一致直接失败）
execFileSync(process.execPath, [join(root, 'scripts', 'sync-version.mjs')], { cwd: root, stdio: 'inherit' })

// 2) 渲染层构建（含类型检查）
execSync('npm run build', { cwd: root, stdio: 'inherit' })

// 3) 运行时必须在位（缺了打出来的包在 Win7 起不来，宁可硬失败）
{
  const rt = join(root, cfg.runtime)
  if (!existsSync(join(rt, 'msedgewebview2.exe'))) {
    console.error(
      `缺少 WebView2 运行时：${rt}\n先运行：node scripts/fetch-webview2-runtime.mjs（或按脚本提示手动放入 cab/目录）`
    )
    process.exit(1)
  }
}

// 4) tauri build（NSIS 安装包）
const tauriJs = join(root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js')
if (!existsSync(tauriJs)) {
  console.error(`找不到 Tauri CLI：${tauriJs}（先 npm install）`)
  process.exit(1)
}
const buildArgs = [tauriJs, 'build', '--target', cfg.triple, '--bundles', 'nsis']
buildArgs.push('--config', join(root, cfg.overlay))
run(process.execPath, buildArgs)

// 5) 定位 NSIS 产物 → release/<label>/mini-todo-setup-<ver>-<combo>.exe
const nsisDir = join(targetDir, 'bundle', 'nsis')
const setup = existsSync(nsisDir)
  ? readdirSync(nsisDir)
      .filter((f) => f.toLowerCase().endsWith('.exe'))
      .map((f) => join(nsisDir, f))
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
  : null
if (!setup) {
  console.error(`未找到 NSIS 安装包：${nsisDir}`)
  process.exit(1)
}
rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
const setupName = `mini-todo-setup-${pkg.version}-${combo}.exe`
renameSync(setup, join(outDir, setupName))

// 6) 绿色版 zip：组 staging（exe + WebView2 固定版运行时）后压缩
const appExe = join(targetDir, 'mini-todo.exe')
if (!existsSync(appExe)) {
  console.error(`未找到应用二进制：${appExe}`)
  process.exit(1)
}
const staging = join(root, 'tmp', `stage-${combo}`)
rmSync(staging, { recursive: true, force: true })
mkdirSync(staging, { recursive: true })
cpSync(appExe, join(staging, 'mini-todo.exe'))
cpSync(join(root, cfg.runtime), join(staging, 'webview2-runtime'), { recursive: true })
const zipName = `mini-todo-portable-${pkg.version}-${combo}.zip`
const zipPath = join(outDir, zipName)
rmSync(zipPath, { force: true })
// 绿色版要压 ~200MB（含运行时），用系统自带 bsdtar：比 PowerShell Compress-Archive 快数倍
const BSDTAR = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
if (existsSync(BSDTAR)) {
  execFileSync(BSDTAR, ['-a', '-cf', zipPath, '-C', staging, ...readdirSync(staging)], { stdio: 'inherit' })
} else {
  execSync(
    `powershell -NoProfile -Command "Compress-Archive -Path '${join(staging, '*')}' -DestinationPath '${zipPath}' -Force"`,
    { cwd: root, stdio: 'inherit' }
  )
}
rmSync(staging, { recursive: true, force: true })

// 7) 前置补丁（从 win7-patches/ 按架构筛含 6.1 的 .msu）；缺补丁源只提示不失败
{
  const patchSrc = join(root, 'win7-patches')
  const patchDir = join(outDir, '前置补丁')
  mkdirSync(patchDir, { recursive: true })
  const patches = existsSync(patchSrc)
    ? readdirSync(patchSrc).filter(
        (f) => f.endsWith('.msu') && f.includes('6.1') && f.includes(cfg.patchArch)
      )
    : []
  if (patches.length === 0) {
    console.log(
      `\n[提示] win7-patches/ 里没有 ${cfg.patchArch} 的 .msu 补丁，本次不附补丁。\n         首次打包前请放入 4 个 .msu（见 README 构建章节）。`
    )
  } else {
    for (const f of patches) cpSync(join(patchSrc, f), join(patchDir, f))
  }
  // 直接用 Node 写（UTF-8 无 BOM，与旧分发目录一致）；不走 PowerShell here-string，
  // 中文经过 execSync 的命令行传递会变成乱码
  writeFileSync(join(patchDir, '安装说明.txt'), PATCH_README, 'utf8')
}

console.log(`\n完成：release/${cfg.label}/`)
for (const f of readdirSync(outDir)) console.log(`  ${f}`)
