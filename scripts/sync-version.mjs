// 版本号同步：package.json <-> src-tauri/tauri.conf.json
// 用法：
//   node scripts/sync-version.mjs            # 校验一致并打印版本（不一致即非零退出）
//   node scripts/sync-version.mjs --check    # 同上（显式模式）
//   node scripts/sync-version.mjs 1.2.0      # 把版本写入两处
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkgPath = join(root, 'package.json')
const confPath = join(root, 'src-tauri', 'tauri.conf.json')

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
const conf = JSON.parse(readFileSync(confPath, 'utf8'))
const arg = process.argv[2]

if (arg && arg !== '--check') {
  const v = arg.replace(/^v/, '')
  if (!/^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/.test(v)) {
    console.error(`版本号格式不对：${arg}（期望 semver，如 1.2.0）`)
    process.exit(1)
  }
  pkg.version = v
  conf.version = v
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
  writeFileSync(confPath, JSON.stringify(conf, null, 2) + '\n')
  console.log(`已写入版本 ${v}（package.json + tauri.conf.json）`)
  process.exit(0)
}

if (pkg.version !== conf.version) {
  console.error(
    `版本不一致：package.json=${pkg.version}，tauri.conf.json=${conf.version}\n先运行：node scripts/sync-version.mjs <版本>`
  )
  process.exit(1)
}
console.log(`版本一致：${pkg.version}`)
