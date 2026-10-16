// 步骤 2:日期与查询纯函数边界
const t = window.__todoTest
for (const bad of ['2026-2-3', '2026-13-01', '2026-02-30', '', 'x', '20261007']) {
  eq(t.isDate(bad), false, `isDate 应拒绝 ${JSON.stringify(bad)}`)
}
for (const good of ['2026-10-07', '2024-02-29']) eq(t.isDate(good), true, `isDate 应接受 ${good}`)
eq(t.label(''), '未排期', '空日期标签')

const pad = (n) => String(n).padStart(2, '0')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const d = new Date()
const at = (n) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}` }
const todayStr = at(0)

await t.importJson(JSON.stringify({ groups: [], lists: [], todos: [] }))
await t.newTask({ title: 'od-2', date: at(-2), prio: 1 })
await t.newTask({ title: 'w7-0', date: todayStr, prio: 1 })
await t.newTask({ title: 'w7-6', date: at(6), prio: 1 })
await t.newTask({ title: 'w7-7', date: at(7), prio: 1 })
await t.flush()

t.setView('week7')
const week7 = t.listRows().map((r) => r.title)
t.setView('today')
await sleep(150) // 等 Vue 把看板重渲染到「今天」视图,再查卡片 DOM(否则查到的还是上一个视图)
const today = t.listRows().map((r) => r.title)
const odBadge = document.querySelector('[data-overdue]')?.textContent ?? ''
t.setView('all')

truthy(week7.includes('w7-0'), 'week7 应含今天')
truthy(week7.includes('w7-6'), 'week7 应含第 6 天(闭区间)')
assert(!week7.includes('w7-7'), 'week7 不应含第 7 天')
assert(!week7.includes('od-2'), 'week7 不应含逾期(它是未来 7 天)')
eq(today, ['od-2', 'w7-0'], 'today = 逾期 + 今天(日期升序,逾期在前)')
truthy(t.counts().today === 2, `侧栏/状态栏口径应含逾期(实际 ${t.counts().today})`)
truthy(odBadge.includes('逾期 2 天'), `卡片应标逾期天数(实际「${odBadge}」)`)
truthy(t.label(todayStr).startsWith('今天'), 'label(今天)')
return { week7, today, odBadge }
