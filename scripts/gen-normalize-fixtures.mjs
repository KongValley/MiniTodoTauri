// 用 TS 版 normalizeStore 生成 fixture 对照集，Rust 侧测试逐条对照 —— 防止两份实现漂移。
// 用法：node --import ./scripts/ts-resolve-hook.mjs --experimental-strip-types scripts/gen-normalize-fixtures.mjs [--check]
//   --check：只校验现有 fixture 与当前 TS 实现一致（CI 用，不一致即非零退出）
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeStore } from '../src/shared/store-ops.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'src-tauri', 'tests', 'fixtures', 'normalize')
const checkOnly = process.argv.includes('--check')

// 旧版 C# 数据样本（与 step4 相同）
const legacySample = {
  groups: [
    { id: '6d8ae94af3', name: '工作' },
    { id: '34d79f911b', name: '生活' }
  ],
  lists: [
    { id: '7eaee681d4', gid: '6d8ae94af3', name: '内容生产', color: '#3A7AFE' },
    { id: '9ba7de473b', gid: '6d8ae94af3', name: '待办事务', color: '#7C5CFF' },
    { id: 'dc3277c2a7', gid: '34d79f911b', name: '生活杂事', color: '#F2A33C' },
    { id: 'cf9f7e6985', gid: '34d79f911b', name: '健康', color: '#3C9954' },
    { id: 'ac02528592', gid: '34d79f911b', name: '装修', color: '#12A5B8' }
  ],
  todos: [
    {
      id: '8c1ed70edb',
      lid: '7eaee681d4',
      title: 'AI任务管理视频（本周发布）',
      note: '本周发布',
      date: '2026-10-07',
      prio: 1,
      status: 0,
      seq: 1
    },
    { id: '3ece1da865', lid: '9ba7de473b', title: '整理本周工作周报', note: '', date: '2026-10-07', prio: 2, status: 0, seq: 2 },
    { id: 'a1b2c3d4e5', lid: '', title: '随手记', note: '', date: '', prio: 2, status: 0, seq: 3 }
  ]
}

const fixtures = [
  ['empty-object', {}],
  ['scalar', 'x'],
  ['array-top', [1, 2, 3]],
  ['non-array-fields', { groups: 1, lists: 'x', todos: null }],
  [
    'dup-ids',
    {
      groups: [
        { id: 'aaa', name: 'A' },
        { id: 'aaa', name: 'B' }
      ],
      lists: [
        { id: 'lll', gid: 'aaa', name: 'L', color: '#3A7AFE' },
        { id: 'lll', gid: 'aaa', name: 'M' }
      ],
      todos: [
        { id: 'ttt', lid: 'lll', title: 'T' },
        { id: 'ttt', lid: 'lll', title: 'U' }
      ]
    }
  ],
  [
    'bad-color',
    {
      lists: [
        { id: 'l1', gid: 'g1', name: 'L', color: 'red', order: 0 },
        { id: 'l2', gid: 'g1', name: 'L2', color: '#GGGGGG' }
      ]
    }
  ],
  [
    'dangling-lid',
    {
      groups: [{ id: 'g1', name: 'G', order: 0 }],
      lists: [{ id: 'l1', gid: 'g1', name: 'L', color: '#3A7AFE', order: 0 }],
      todos: [{ id: 't1', lid: 'nope', title: 'T' }]
    }
  ],
  [
    'bad-date',
    {
      todos: [
        { id: 't1', lid: '', title: 'T', date: '2026-2-3' },
        { id: 't2', date: '2026-13-01' },
        { id: 't3', date: '2026-02-30' },
        { id: 't4', date: '2026-02-28' },
        { id: 't5', date: '' },
        { id: 't6' }
      ]
    }
  ],
  [
    'bad-enums',
    {
      todos: [
        { id: 't1', prio: 9 },
        { id: 't2', status: 9 },
        { id: 't3', prio: '1', status: '0' },
        { id: 't4', prio: 1.5, status: 2 }
      ]
    }
  ],
  ['missing-seq-order', { todos: [{ id: 't1' }, { id: 't2', order: 5 }, { id: 't3', seq: 99 }] }],
  [
    'dirty-subtasks',
    { todos: [{ id: 't1', subtasks: [{ title: 's1' }, { id: '', title: 's2', done: 1 }, { id: 's3', title: 's3', done: true }] }] }
  ],
  [
    'dirty-repeat',
    {
      todos: [
        { id: 't1', repeat: { kind: 'weekly' } },
        { id: 't2', repeat: { kind: 'x' } },
        { id: 't3', repeat: { kind: 'monthly', anchorDay: 31 } },
        { id: 't4', repeat: { kind: 'monthly', anchorDay: 0 } },
        { id: 't5', repeat: { kind: 'monthly', anchorDay: 32 } },
        { id: 't6', repeat: 'nope' },
        { id: 't7', repeat: { kind: 'monthly', anchorDay: 3.5 } }
      ]
    }
  ],
  ['missing-createdat', { todos: [{ id: 't1' }, { id: 't2', createdAt: 123 }] }],
  ['done-at-kind', { todos: [{ id: 't1', doneAt: 'x' }, { id: 't2', doneAt: 5 }, { id: 't3', doneAt: 1.5 }] }],
  [
    'extra-keys',
    {
      version: 99,
      extra: true,
      groups: [{ id: 'g1', name: 'G', order: 0, extra: 1 }],
      lists: [],
      todos: [{ id: 't1', zzz: 'x' }]
    }
  ],
  ['legacy-csharp', legacySample]
]

/** 收集输入里出现过的 id 字符串（任意层级、键名为 id） */
function collectInputIds(input) {
  const ids = new Set()
  const walk = (v) => {
    if (Array.isArray(v)) {
      v.forEach(walk)
      return
    }
    if (v && typeof v === 'object') {
      for (const [k, val] of Object.entries(v)) {
        if (k === 'id' && typeof val === 'string') ids.add(val)
        walk(val)
      }
    }
  }
  walk(input)
  return ids
}

/** 掩码：新生成的 id → "__new__"；由缺失 createdAt 补出的值 → "__now__" */
function mask(input, output) {
  const inputIds = collectInputIds(input)
  const out = JSON.parse(JSON.stringify(output))
  const walk = (v) => {
    if (Array.isArray(v)) {
      v.forEach(walk)
      return
    }
    if (v && typeof v === 'object') {
      for (const [k, val] of Object.entries(v)) {
        if (k === 'id' && typeof val === 'string' && !inputIds.has(val)) v[k] = '__new__'
        else walk(val)
      }
    }
  }
  walk(out)
  const inputTodos = Array.isArray(input?.todos) ? input.todos : []
  const outTodos = Array.isArray(out.todos) ? out.todos : []
  for (let i = 0; i < outTodos.length; i++) {
    const src = inputTodos[i]
    const hasCreated = src && typeof src === 'object' && typeof src.createdAt === 'number' && Number.isFinite(src.createdAt)
    if (!hasCreated && outTodos[i] && typeof outTodos[i] === 'object') {
      outTodos[i].createdAt = '__now__'
    }
  }
  return out
}

const expectedFiles = new Set()

export function buildAll() {
  return fixtures.map(([name, input]) => {
    const masked = mask(input, normalizeStore(input))
    return { name, input, expected: masked }
  })
}

const all = buildAll()
mkdirSync(outDir, { recursive: true })

if (checkOnly) {
  let bad = 0
  for (const { name, expected } of all) {
    const file = join(outDir, `${name}.expected.json`)
    expectedFiles.add(`${name}.expected.json`)
    if (!existsSync(file)) {
      console.error(`缺少 fixture:${name}.expected.json`)
      bad++
      continue
    }
    const cur = readFileSync(file, 'utf8')
    const want = JSON.stringify(expected, null, 2) + '\n'
    if (cur !== want) {
      console.error(`fixture 与 TS 实现不一致:${name}.expected.json`)
      bad++
    }
  }
  for (const f of readdirSync(outDir)) {
    if (f.endsWith('.expected.json') && !expectedFiles.has(f)) {
      console.error(`多余的 fixture(TS 侧已删除):${f}`)
      bad++
    }
  }
  if (bad > 0) {
    console.error(`\n${bad} 个 fixture 需要更新,运行: npm run fixtures`)
    process.exit(1)
  }
  console.log(`fixture 全部一致(${all.length} 组)`)
} else {
  for (const { name, input, expected } of all) {
    writeFileSync(join(outDir, `${name}.input.json`), JSON.stringify(input, null, 2) + '\n')
    writeFileSync(join(outDir, `${name}.expected.json`), JSON.stringify(expected, null, 2) + '\n')
  }
  // 清理已删除 fixture 的遗留文件
  for (const f of readdirSync(outDir)) {
    const stem = f.replace(/\.(input|expected)\.json$/, '')
    if ((f.endsWith('.input.json') || f.endsWith('.expected.json')) && !fixtures.some(([n]) => n === stem)) {
      rmSync(join(outDir, f))
    }
  }
  console.log(`已生成 ${all.length} 组 fixture → src-tauri/tests/fixtures/normalize/`)
}
