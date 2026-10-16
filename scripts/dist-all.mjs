// 并行打两个架构：cargo 对整个 target 目录加锁 → 两个 triple 的编译自动串行，
// 单核的 makensis / Compress-Archive 正好与另一组合的 cargo 重叠。
// 渲染层在这里统一构建一次，子进程用 --no-frontend 跳过重复构建（也避免两个 vite 并发重写 dist/）。
import { spawn, spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const combos = ['win7-ia32', 'win7-x64']
const secs = (ms) => `${(ms / 1000).toFixed(0)}s`

const step = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit' })
  if (r.status !== 0) process.exit(r.status ?? 1)
}
// npm 在 Windows 上是 .cmd，必须经 cmd.exe 调用；不能用 shell:true —— 那会把
// `C:\Program Files\nodejs\node.exe` 按空格拆成 `C:\Program`
const stepNpm = (script) =>
  process.platform === 'win32'
    ? step('cmd.exe', ['/d', '/s', '/c', `npm run ${script}`])
    : step('npm', ['run', script])

const t0 = Date.now()
step(process.execPath, [join(root, 'scripts', 'sync-version.mjs')])
stepNpm('build')

const runs = combos.map((combo) => {
  const child = spawn(process.execPath, [
    join(root, 'scripts', 'package-win.mjs'),
    combo,
    '--no-frontend'
  ], { cwd: root })
  const out = []
  child.stdout.on('data', (d) => out.push(d))
  child.stderr.on('data', (d) => out.push(d))
  return { combo, child, out, start: Date.now(), ms: null, code: null }
})

await Promise.all(
  runs.map(
    (r) =>
      new Promise((res) => {
        r.child.on('close', (code) => {
          r.code = code
          r.ms = Date.now() - r.start
          res()
        })
      })
  )
)

for (const r of runs) {
  console.log(`\n===== ${r.combo}（${secs(r.ms)}）=====`)
  process.stdout.write(Buffer.concat(r.out))
}
console.log(`\n总耗时 ${secs(Date.now() - t0)}：${runs.map((r) => `${r.combo} ${secs(r.ms)}`).join('，')}`)
process.exit(runs.some((r) => r.code !== 0) ? 1 : 0)
