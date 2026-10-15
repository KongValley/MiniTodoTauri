// 获取 WebView2 固定版 109 运行时（Win7 上受支持的最后一个版本）并展开：
//   1) 优先用仓库根 webview2-109/ 中已有的 cab（Microsoft.WebView2.FixedVersionRuntime.*.<arch>.cab）
//   2) 否则尝试 gh release download webview2-109（本仓库的一次性种子 Release）
//   3) 校验 SHA256SUMS（若存在）后，用 expand.exe 展开到 webview2-runtime-x86/ 与 webview2-runtime-x64/
// 失败一律非零退出 —— 没有运行时的 Win7 包在机器上根本起不来，静默降级比构建失败危险得多。
import { execFileSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync
} from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const cabDir = join(root, 'webview2-109')
const SYS = process.env.SystemRoot || 'C:\\Windows'
// 必须用 System32 里的 bsdtar/expand 绝对路径：CI 的 PATH 里 Git 自带 GNU tar 在前，
// 它会把 "D:\..." 当远程主机（tar: Cannot connect to D: resolve failed）。
const BSDTAR = join(SYS, 'System32', 'tar.exe')
const EXPAND = join(SYS, 'System32', 'expand.exe')

function log(msg) {
  console.log(`[webview2] ${msg}`)
}

function tryGhDownload(arch) {
  try {
    execFileSync(
      'gh',
      ['release', 'download', 'webview2-109', '--pattern', `*.${arch}*`, '--dir', cabDir, '--clobber'],
      { stdio: 'inherit' }
    )
    return findCab(arch)
  } catch {
    return null
  }
}

function findCab(arch) {
  if (!existsSync(cabDir)) return null
  // 官方发布是 .cab；本地/NuGet 镜像可能是 .nupkg（同样是压缩包，用 tar 解）
  const files = readdirSync(cabDir)
  const match = (suffix) =>
    files.find(
      (f) =>
        f.toLowerCase().endsWith(suffix) &&
        (f.includes(`.${arch}.`) || f.includes(`_${arch}`) || f.includes(`-${arch}`))
    )
  return match('.cab') ? join(cabDir, match('.cab')) : match('.nupkg') ? join(cabDir, match('.nupkg')) : null
}

function extractArchive(archive, outDir) {
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  if (archive.toLowerCase().endsWith('.cab')) {
    execFileSync(EXPAND, [archive, '-F:*', outDir], { stdio: 'inherit' })
  } else if (existsSync(BSDTAR)) {
    // nupkg 就是 zip，用 Windows 自带 bsdtar 解（绝对路径，绕开 Git 的 GNU tar）
    execFileSync(BSDTAR, ['-xf', archive, '-C', outDir], { stdio: 'inherit' })
  } else {
    // 兜底：PowerShell 的 Expand-Archive（能解 nupkg/zip，路径语义按 Windows 处理）
    execFileSync(
      'powershell',
      ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${archive}' -DestinationPath '${outDir}' -Force`],
      { stdio: 'inherit' }
    )
  }
  // 压缩包内可能带一层版本目录，抹平到根（应用按 exe 同目录的 webview2-runtime/ 找文件）
  const entries = readdirSync(outDir)
  const hasExeAtRoot = entries.some((f) => f.toLowerCase() === 'msedgewebview2.exe')
  if (!hasExeAtRoot) {
    // 递归找到 msedgewebview2.exe 所在目录，把它的内容搬到根
    const stack = entries.map((f) => join(outDir, f))
    while (stack.length) {
      const cur = stack.pop()
      if (!statSync(cur).isDirectory()) continue
      const inner = readdirSync(cur)
      if (inner.some((f) => f.toLowerCase() === 'msedgewebview2.exe')) {
        for (const name of inner) {
          renameSync(join(cur, name), join(outDir, name))
        }
        rmSync(cur, { recursive: true, force: true })
        break
      }
      for (const f of inner) stack.push(join(cur, f))
    }
  }
  if (!existsSync(join(outDir, 'msedgewebview2.exe'))) {
    console.error(`解包后未找到 msedgewebview2.exe：${outDir}\n压缩包内容异常，请检查来源。`)
    process.exit(1)
  }
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function checkSums(file) {
  const sums = join(cabDir, 'SHA256SUMS')
  if (!existsSync(sums)) {
    log(`未找到 ${sums}，跳过校验`)
    return
  }
  const name = file.split(/[\\/]/).pop()
  const line = readFileSync(sums, 'utf8')
    .split(/\r?\n/)
    .find((l) => l.includes(name))
  if (!line) {
    log(`SHA256SUMS 中没有 ${name} 的记录，跳过校验`)
    return
  }
  const want = line.trim().split(/\s+/)[0].toLowerCase()
  const got = sha256(file).toLowerCase()
  if (want !== got) {
    console.error(`SHA256 不匹配：${name}\n  期望 ${want}\n  实际 ${got}`)
    process.exit(1)
  }
  log(`SHA256 校验通过：${name}`)
}

for (const arch of ['x86', 'x64']) {
  const outDir = join(root, arch === 'x86' ? 'webview2-runtime-x86' : 'webview2-runtime-x64')
  if (existsSync(join(outDir, 'msedgewebview2.exe'))) {
    log(`${outDir} 已就绪，跳过`)
    continue
  }
  let archive = findCab(arch)
  if (!archive) {
    log(`本地没有 ${arch} 的运行时压缩包（.cab/.nupkg），尝试从种子 Release 下载 …`)
    mkdirSync(cabDir, { recursive: true })
    archive = tryGhDownload(arch)
  }
  if (!archive) {
    console.error(
      `取不到 WebView2 ${arch} 固定版运行时。三种获取方式任选：\n` +
        `  1) 从微软官网下载 Microsoft.WebView2.FixedVersionRuntime.109.*.${arch}.cab 放到 webview2-109/\n` +
        `  2) 运行 gh release download webview2-109 --pattern "*.${arch}*" --dir webview2-109\n` +
        `  3) 从一台已装 WebView2 109 的机器复制运行时目录内容到 ${outDir}/\n` +
        `（109 是 Win7 上最后一个受支持的 WebView2 版本）`
    )
    process.exit(1)
  }
  checkSums(archive)
  log(`展开 ${archive} → ${outDir}`)
  extractArchive(archive, outDir)
}

// 兼容辅助：外部若把解压好的目录放在 webview2-109/<arch>/，这里帮忙搬一次
for (const arch of ['x86', 'x64']) {
  const src = join(cabDir, arch)
  const dst = join(root, arch === 'x86' ? 'webview2-runtime-x86' : 'webview2-runtime-x64')
  if (existsSync(src) && !existsSync(join(dst, 'msedgewebview2.exe'))) {
    cpSync(src, dst, { recursive: true })
    log(`已从 webview2-109/${arch}/ 复制到 ${dst}`)
  }
}
