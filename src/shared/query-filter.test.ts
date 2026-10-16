/**
 * 两维筛选(优先级 + 重复性)共享层自检:
 *   node --test src/shared/query-filter.test.ts(经 npm test 全量跑)
 * 夹具值全部由 today()/addDays() 现场算,不写死日期。
 * 每条 case 都新建一份夹具:筛选用到的「未完成 / 未排期 / 重复」属性
 * 一旦被上一条用例改过,后面的断言就失去意义。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { addDays, today } from './dates'
import { DEFAULT_TASK_FILTER, columnsForView, hitsFor, sortedByIndex, type TaskFilter } from './query'
import { buildIndex } from './store-index'
import { normalizeStore } from './store-ops'
import { ACTIVE, DONE, TRASH, type Prio, type RepeatKind, type Status, type Store, type TodoItem } from './types'

const base: TodoItem = {
  id: '',
  lid: '',
  title: '',
  note: '',
  date: '',
  prio: 2,
  status: ACTIVE,
  seq: 0,
  order: 0,
  subtasks: [],
  repeat: { kind: 'none' },
  createdAt: 0,
  doneAt: null,
  deletedAt: null
}

/**
 * 固定夹具:A/B/C/E/F 未完成,D 在 8 天后,G 已完成,H 在回收站。
 * seq 单调递增,让「默认顺序」有唯一解。
 */
function fixture(): Store {
  const t0 = today()
  const t8 = addDays(t0, 8)
  const row = (
    id: string,
    date: string,
    prio: Prio,
    kind: RepeatKind,
    lid: string,
    seq: number,
    status: Status = ACTIVE
  ): TodoItem => ({ ...base, id, title: `${id}报告`, date, prio, lid, seq, status, repeat: { kind } })

  return normalizeStore({
    version: 2,
    groups: [],
    lists: [
      { id: 'L1', gid: '', name: '清单甲', color: '#3A7AFE', order: 0 },
      { id: 'L2', gid: '', name: '清单乙', color: '#3C9954', order: 1 }
    ],
    todos: [
      row('A', t0, 1, 'monthly', 'L1', 1),
      row('B', t0, 1, 'none', 'L1', 2),
      row('C', t0, 2, 'daily', 'L1', 3),
      row('D', t8, 1, 'monthly', 'L1', 4),
      row('E', '', 1, 'weekly', 'L1', 5),
      row('F', t0, 1, 'daily', 'L2', 6),
      row('G', t0, 1, 'daily', 'L1', 7, DONE),
      row('H', t0, 1, 'monthly', 'L1', 8, TRASH)
    ]
  })
}

const HIGH_RECURRING: TaskFilter = { prio: 1, repeat: 'recurring' }

const idsOf = (list: readonly TodoItem[]): string[] => list.map((t) => t.id)

test('默认参数与旧口径一致:不筛时结果、排序都不变', () => {
  const store = fixture()
  const index = buildIndex(store, '')
  const hitsBefore = idsOf(index.hits)

  assert.deepEqual(idsOf(hitsFor(index, 'all')), ['A', 'B', 'C', 'D', 'E', 'F'])
  assert.deepEqual(idsOf(hitsFor(index, 'all', DEFAULT_TASK_FILTER)), ['A', 'B', 'C', 'D', 'E', 'F'])
  // 默认顺序:日期升序 → 优先级 → 清单名 → seq;未排期恒在末位
  assert.deepEqual(idsOf(sortedByIndex(index, 'all')), ['A', 'B', 'F', 'C', 'D', 'E'])
  assert.deepEqual(idsOf(sortedByIndex(index, 'all', null, DEFAULT_TASK_FILTER)), ['A', 'B', 'F', 'C', 'D', 'E'])
  // 全程没有改写共享索引
  assert.deepEqual(idsOf(index.hits), hitsBefore)
})

test('两维筛选是 AND:今天 + 高 + 重复 → 只有 A/F', () => {
  const index = buildIndex(fixture(), '')
  assert.deepEqual(idsOf(hitsFor(index, 'today', HIGH_RECURRING)), ['A', 'F'])
  // 换任一维都会换掉结果集:高 + 重复(不限视图)含未排期的 E 与 8 天后的 D
  assert.deepEqual(idsOf(hitsFor(index, 'all', HIGH_RECURRING)), ['A', 'D', 'E', 'F'])
  // 视图状态口径不变:已完成/回收站各自仍只看自己的项(筛选只在视图内部做交集)
  assert.deepEqual(idsOf(hitsFor(index, 'done', HIGH_RECURRING)), ['G'])
  assert.deepEqual(idsOf(hitsFor(index, 'trash', HIGH_RECURRING)), ['H'])
  assert.deepEqual(idsOf(hitsFor(index, 'today', HIGH_RECURRING)), ['A', 'F'])
})

test('repeat=none 只留一次性任务', () => {
  const index = buildIndex(fixture(), '')
  const onlyOnce: TaskFilter = { prio: 0, repeat: 'none' }
  assert.deepEqual(idsOf(hitsFor(index, 'all', onlyOnce)), ['B'])
  // 优先级维度不生效(0 = 不筛):高优先级的 B 与中优先级的 C 之外没有第三条一次性任务
  assert.deepEqual(idsOf(hitsFor(index, 'today', { prio: 0, repeat: 'none' })), ['B'])
})

test('清单视图:筛选后的列表含未排期的 E,看板列不含(未排期不进列)', () => {
  const index = buildIndex(fixture(), '')
  assert.deepEqual(idsOf(hitsFor(index, 'list:L1', HIGH_RECURRING)), ['A', 'D', 'E'])
  const cols = columnsForView(index, 'list:L1', HIGH_RECURRING)
  assert.deepEqual(
    cols.map((c) => [c.date, idsOf(c.items)]),
    [
      [today(), ['A']],
      [addDays(today(), 8), ['D']]
    ]
  )
  // 不筛时同一视图的列数更多(A/B/C 都在今天)
  assert.equal(columnsForView(index, 'list:L1').length, 2)
  assert.equal(cols.length, 2)
})

test('筛选与搜索是 AND:只留同时命中两者的项', () => {
  const a = buildIndex(fixture(), 'A报告')
  assert.deepEqual(idsOf(hitsFor(a, 'all')), ['A'])
  assert.deepEqual(idsOf(hitsFor(a, 'all', HIGH_RECURRING)), ['A'])

  const both = buildIndex(fixture(), '报告')
  assert.deepEqual(idsOf(hitsFor(both, 'all', HIGH_RECURRING)), ['A', 'D', 'E', 'F'])
  assert.deepEqual(idsOf(hitsFor(both, 'all', { prio: 2, repeat: 'all' })), ['C'])
})

test('看板列与列表排序都透传筛选,且不改写共享索引', () => {
  const index = buildIndex(fixture(), '')
  const hitsBefore = idsOf(index.hits)

  // 同优先级平手回落到 seq(A→D→F),未排期的 E 恒在末位(不参与升降翻转)
  assert.deepEqual(idsOf(sortedByIndex(index, 'all', { key: 'prio', desc: true }, HIGH_RECURRING)), [
    'A',
    'D',
    'F',
    'E'
  ])
  assert.deepEqual(
    columnsForView(index, 'all', { prio: 3, repeat: 'all' }).map((c) => idsOf(c.items)),
    []
  )
  // 排序/分桶都在副本上做:共享索引的成员与顺序原样不动
  assert.deepEqual(idsOf(index.hits), hitsBefore)
})
