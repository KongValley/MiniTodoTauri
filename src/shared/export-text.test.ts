/**
 * 导出文本格式自检(零依赖,node --test 运行):
 *   node --import ./scripts/ts-resolve-hook.mjs --experimental-strip-types --test "src/shared/*.test.ts"
 * 两份格式是「对外承诺」,所以按整篇全文断言(逐字节),而不是零散地查 includes。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { csvOf, markdownOf } from './export-text'
import { label } from './dates'
import { ACTIVE, DONE, DROPPED, type TodoItem } from './types'

const base: TodoItem = {
  id: 't1',
  lid: '',
  title: '',
  note: '',
  date: '',
  prio: 2,
  status: ACTIVE,
  seq: 1,
  order: 0,
  subtasks: [],
  repeat: { kind: 'none' },
  createdAt: 0,
  doneAt: null,
  deletedAt: null
}

/** 2026-10-16 是周五 */
const NOON = new Date(2026, 9, 16, 14, 5).getTime()

const rows: TodoItem[] = [
  {
    ...base,
    id: 'a',
    lid: 'L1',
    title: '写周报',
    note: '先写\n再改',
    date: '2026-10-17',
    prio: 1,
    subtasks: [
      { id: 's1', title: '收集数据', done: true },
      { id: 's2', title: '写正文', done: false }
    ]
  },
  { ...base, id: 'b', lid: 'L1', title: '带"引号"的标题', note: '逗号,也在', date: '2026-10-17', prio: 3 },
  { ...base, id: 'c', lid: '', title: '已完成的事', date: '2026-10-17', status: DONE, doneAt: NOON },
  { ...base, id: 'd', lid: '', title: '随手记', date: '' },
  { ...base, id: 'e', lid: '', title: '放弃的事', date: '2026-10-18', status: DROPPED }
]

const listNameOf = (lid: string): string => (lid === 'L1' ? '工作清单' : '收集箱')

test('markdownOf 全文:按日期分组、优先级标注、备注折行、子任务打勾、未排期在最后', () => {
  // 段标题走与实现同一个 label()(它的五种形态由 store-ops.test.ts 逐字钉住) ——
  // 这里钉的是格式:分组顺序、勾选、优先级标注、备注折行、空行与结尾换行。
  const want = [
    '# 迷你待办 · 最近7天',
    '',
    '导出于 2026-10-16 14:05，共 5 条。',
    '',
    `## ${label('2026-10-17')}`,
    '- [ ] 写周报（高）',
    '    > 先写 再改',
    '    - [x] 收集数据',
    '    - [ ] 写正文',
    '- [ ] 带"引号"的标题（低）',
    '    > 逗号,也在',
    '- [x] 已完成的事',
    '',
    `## ${label('2026-10-18')}`,
    '- [ ] 放弃的事',
    '',
    '## 未排期',
    '- [ ] 随手记',
    ''
  ].join('\n')
  assert.equal(markdownOf(rows, '最近7天', NOON), want)
})

test('markdownOf 恒以单个换行结尾,空列表也有表头', () => {
  assert.equal(
    markdownOf([], '全部', NOON),
    ['# 迷你待办 · 全部', '', '导出于 2026-10-16 14:05，共 0 条。', ''].join('\n')
  )
  const text = markdownOf(rows, 'x', NOON)
  assert.equal(text.endsWith('- [ ] 随手记\n'), true)
  assert.equal(text.endsWith('\n\n'), false, '末尾不许多一个空行')
})

test('csvOf 全文:固定列序、字段全引号、引号翻倍、CRLF、子任务 x/y', () => {
  const want = [
    '状态,标题,日期,优先级,清单,备注,子任务,完成时间',
    '"待办","写周报","2026-10-17","高","工作清单","先写\n再改","1/2",""',
    '"待办","带""引号""的标题","2026-10-17","低","工作清单","逗号,也在","0/0",""',
    '"已完成","已完成的事","2026-10-17","中","收集箱","","0/0","10月16日 14:05"',
    '"待办","随手记","","中","收集箱","","0/0",""',
    '"已放弃","放弃的事","2026-10-18","中","收集箱","","0/0",""',
    ''
  ].join('\r\n')
  assert.equal(csvOf(rows, listNameOf), want)
})

test('csvOf 的行数与列数恒等于输入(不会被字段里的逗号撑破)', () => {
  const lines = csvOf(rows, listNameOf).trimEnd().split('\r\n')
  assert.equal(lines.length, rows.length + 1, '表头 + 每行一条')
  for (const line of lines) {
    // 引号内的逗号不该计入分隔符:按「引号外的逗号」计数应为 7
    let inside = false
    let commas = 0
    for (const ch of line) {
      if (ch === '"') inside = !inside
      else if (ch === ',' && !inside) commas++
    }
    assert.equal(commas, 7, `列数应为 8:${line}`)
  }
})
