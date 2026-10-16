// 步骤 36:「已完成」整理与统计(按完成日期分段 / 按完成时间倒序 / 清理早于 N 天)+「已放弃」清空
//
// 覆盖三件容易错的事:
//   1. 分段与排序都按 doneAt(不是 date),doneAt 缺失的旧数据要自成一段且不参与清理
//   2. 清理只移入回收站(可恢复),并且可撤销 —— 不是真删
//   3. 已放弃的清空同样走回收站
const t = window.__todoTest
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const DAY = 86400000
const pad = (n) => String(n).padStart(2, '0')
const d = new Date()
const todayStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

const done = (id, title, doneAt) => ({
  id,
  lid: '',
  title,
  note: '',
  date: todayStr,
  prio: 2,
  status: 1,
  seq: 1,
  order: 0,
  subtasks: [],
  repeat: { kind: 'none' },
  createdAt: 0,
  doneAt,
  deletedAt: null
})

await t.importJson(
  JSON.stringify({
    groups: [],
    lists: [],
    todos: [
      done('d-old', '十天前完成的', Date.now() - 10 * DAY),
      done('d-now', '刚完成的', Date.now() - 1000),
      done('d-unknown', '完成时间未知的', null),
      { ...done('drop1', '放弃的', null), status: 2 }
    ]
  })
)
await t.flush()
t.setBoard(false)
t.setView('done')
await sleep(250)

const secs = [...document.querySelectorAll('[data-sec]')].map((el) => el.dataset.sec)
eq(secs.length, 3, `三段:今天 / 十天前 / 未知(实际 ${JSON.stringify(secs)})`)
truthy(secs[0].startsWith('今天'), `首段应是今天(实际 ${secs[0]})`)
eq(secs[2], '完成时间未知', 'doneAt 缺失的自成末段')

const rowIds = [...document.querySelectorAll('[data-row]')].map((el) => el.dataset.row)
eq(rowIds[0], 'd-now', '首行是最近完成的那条(按完成时间倒序)')
eq(rowIds[rowIds.length - 1], 'd-unknown', '完成时间未知的沉到最后')

const countText = document.querySelector('[data-testid="list-count"]').textContent
truthy(countText.includes('近 7 天完成 1 条'), `工具条应给出近 7 天完成数(实际「${countText.trim()}」)`)

// 清理早于 7 天:只命中「十天前完成的」那条
const sel = document.querySelector('[data-testid="clean-done"]')
sel.value = '7'
sel.dispatchEvent(new Event('change'))
await sleep(150)
truthy(!!document.querySelector('[data-testid="confirm-dialog"]'), '清理要二次确认')
truthy(
  document.querySelector('[data-testid="confirm-dialog"]').textContent.includes('移入回收站（可恢复）'),
  '确认文案点明进回收站、可恢复'
)
document.querySelector('[data-testid="confirm-ok"]').click()
await t.flush()
await sleep(200)
const after = t.todos().find((x) => x.id === 'd-old')
eq(after.status, 3, '十天前完成的那条进了回收站(不是真删)')
truthy(!!t.todos().find((x) => x.id === 'd-unknown'), 'doneAt 缺失的旧数据没被清理')

const undoBtn = document.querySelector('[data-testid="toast-action"]')
truthy(!!undoBtn, '清理后应有撤销按钮')
undoBtn.click()
await t.flush()
await sleep(200)
eq(t.todos().find((x) => x.id === 'd-old').status, 1, '撤销把清理掉的那条带回来了')

// 已放弃:清空 → 进回收站
t.setView('dropped')
await sleep(200)
const clearBtn = document.querySelector('[data-testid="clear-dropped"]')
truthy(!!clearBtn, '已放弃视图应有「清空已放弃」')
clearBtn.click()
await sleep(150)
document.querySelector('[data-testid="confirm-ok"]').click()
await t.flush()
await sleep(200)
eq(t.todos().find((x) => x.id === 'drop1').status, 3, '已放弃的那条进了回收站')
eq(t.todos().filter((x) => x.status === 2).length, 0, '已放弃清空后没有剩余项')
truthy(!!document.querySelector('[data-testid="toast-action"]'), '清空后也可撤销')

return { secs, rowIds, countText: countText.trim() }
