// 步骤 31:回收站治理 —— 30 天过期清理(启动时静默跑) + 清空回收站(二次确认)
//
// 覆盖三条最容易错的边界:
//   1. deletedAt 缺失的项永不清理(旧数据没有这个字段)
//   2. 清掉的只有「超过 30 天」的那条,29 天前的必须留着
//   3. 清空是不可恢复的,必须走确认框
const t = window.__todoTest
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const DAY = 86400000

const trashItem = (id, deletedAt) => ({
  id,
  lid: '',
  title: id,
  note: '',
  date: '',
  prio: 2,
  status: 3,
  seq: 1,
  order: 0,
  subtasks: [],
  repeat: { kind: 'none' },
  createdAt: 0,
  doneAt: null,
  deletedAt
})

await t.importJson(
  JSON.stringify({
    groups: [],
    lists: [],
    todos: [
      trashItem('old', Date.now() - 31 * DAY),
      trashItem('recent', Date.now() - 29 * DAY),
      trashItem('unknown', null)
    ]
  })
)
await t.flush()
t.setView('trash')
eq(t.counts().trash, 3, '三条都在回收站')

const removed = await t.cleanupExpiredTrash()
await t.flush()
eq(removed, 1, '只清掉 31 天前那一条')
truthy(!t.todos().some((x) => x.id === 'old'), '过期项已彻底删除')
truthy(!!t.todos().find((x) => x.id === 'recent'), '29 天前的保留')
truthy(!!t.todos().find((x) => x.id === 'unknown'), 'deletedAt 缺失的(旧数据)永不清理')

truthy(!!document.querySelector('[data-testid="empty-trash"]'), '回收站非空时应显示清空入口')
document.querySelector('[data-testid="empty-trash"]').click()
await sleep(150)
truthy(!!document.querySelector('[data-testid="confirm-dialog"]'), '清空必须二次确认')
document.querySelector('[data-testid="confirm-ok"]').click()
await t.flush()
await sleep(200)
eq(t.todos().length, 0, '回收站已清空(彻底删除)')
eq(t.counts().trash, 0, '计数归零')
return { removed, left: t.todos().length }
