// 步骤 41:两维筛选(优先级 / 重复性)—— 显示、选择、拖拽、导出同一口径
//
// 覆盖:看板/列表同结果、未排期提示、搜索 AND、none 只留一次性、选区随命中收窄、
// 被隐藏项不被 Delete/批量误伤、Shift 连选走命中行源、换视图重置/换模式保留、
// 清筛选不动搜索、筛选下的真实拖拽(同列 + 跨日)、重复完成、导出范围与文件名。
//
// 夹具只在这里定义一份:每组开始前重新 importJson + flush,并显式恢复 view/board/search,
// 再用真实控件恢复筛选 —— 上一组的完成/改期/删除不会污染下一组。
const t = window.__todoTest
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const pad = (n) => String(n).padStart(2, '0')
const d = new Date()
const day = (n) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`
}
const todayStr = day(0)
const d8 = day(8)

const q = (sel) => document.querySelector(sel)
const key = (k, opts = {}) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }))
const titles = () => t.listRows().map((r) => r.title)

/** A/B/C/E/F 未完成(今天除了 D 在 8 天后、E 未排期);G 已完成;H 回收站 */
const FIXTURE = JSON.stringify({
  version: 2,
  groups: [],
  lists: [
    { id: 'L1', gid: '', name: '清单甲', color: '#3A7AFE', order: 0 },
    { id: 'L2', gid: '', name: '清单乙', color: '#3C9954', order: 1 }
  ],
  todos: [
    { id: 'A', lid: 'L1', title: 'A报告', date: todayStr, prio: 1, repeat: { kind: 'monthly' } },
    { id: 'B', lid: 'L1', title: 'B报告', date: todayStr, prio: 1 },
    { id: 'C', lid: 'L1', title: 'C报告', date: todayStr, prio: 2, repeat: { kind: 'daily' } },
    { id: 'D', lid: 'L1', title: 'D报告', date: d8, prio: 1, repeat: { kind: 'monthly' } },
    { id: 'E', lid: 'L1', title: 'E报告', date: '', prio: 1, repeat: { kind: 'weekly' } },
    { id: 'F', lid: 'L2', title: 'F报告', date: todayStr, prio: 1, repeat: { kind: 'daily' } },
    { id: 'G', lid: 'L1', title: 'G报告', date: todayStr, prio: 1, status: 1, repeat: { kind: 'daily' } },
    { id: 'H', lid: 'L1', title: 'H报告', date: todayStr, prio: 1, status: 3, repeat: { kind: 'monthly' }, deletedAt: Date.now() }
  ]
})

/** 每组开头都回到同一份基础夹具(显式恢复 搜索/模式/视图) */
async function reset(view, board) {
  await t.importJson(FIXTURE)
  await t.flush()
  t.setSearch('')
  t.setBoard(board)
  t.setView(view)
  await sleep(250)
}

/** 通过真实控件设置筛选:先点优先级按钮,再改重复性下拉 */
async function setFilter(prio, repeat) {
  q(`[data-filter-prio="${prio}"]`).click()
  const sel = q('[data-testid="filter-repeat"]')
  sel.value = repeat
  sel.dispatchEvent(new Event('change'))
  await sleep(250)
}

const prioPressed = (prio) => q(`[data-filter-prio="${prio}"]`).getAttribute('aria-pressed') === 'true'
const bucketIds = (date, prio) => (t.buckets(date).find((b) => b.prio === prio)?.ids ?? [])

/** 真实 DragEvent 链(与 step9 同款):列宽/落点都按实际 rect 算,不走 test-api 直调 */
const mkDrag = (type, y) => {
  const ev = new DragEvent(type, { bubbles: true, cancelable: true, clientY: y, clientX: 10 })
  Object.defineProperty(ev, 'dataTransfer', {
    value: { setData() {}, getData() { return '' }, effectAllowed: 'move', dropEffect: 'move' }
  })
  return ev
}

async function dragCard(cardId, targetEl, y) {
  q(`[data-card="${cardId}"]`).dispatchEvent(mkDrag('dragstart', 0))
  // 等一帧:dragId/dragPrio 经 BoardView 的 ref 传到列组件要经过重渲染
  await sleep(80)
  targetEl.dispatchEvent(mkDrag('dragover', y))
  targetEl.dispatchEvent(mkDrag('drop', y))
  await t.flush()
  await sleep(250)
}

/* ---------- 1) 今天 + 高 + 重复 → 只有 A/F ---------- */
await reset('today', true)
await setFilter(1, 'recurring')
eq(prioPressed(1), true, '优先级按钮处于按下态')
let cols = t.boardColumns()
eq(cols.length, 1, '「今天+高+重复」只剩今天一列')
eq(cols[0].ids, ['A', 'F'], '列内只剩 A/F')
truthy(
  (q('[data-testid="task-tools-count"]').textContent ?? '').includes('显示 2 / 4'),
  `计数提示应写「显示 2 / 4 项」(实际「${q('[data-testid="task-tools-count"]').textContent}」)`
)
t.setBoard(false)
await sleep(250)
eq(titles(), ['A报告', 'F报告'], '列表与看板同一结果')

/* ---------- 2) 清单甲 + 高 + 重复 → A/D/E;未排期的 E 给切列表出口 ---------- */
await reset('list:L1', false)
await setFilter(1, 'recurring')
eq(titles(), ['A报告', 'D报告', 'E报告'], '清单甲筛选后剩 A/D/E')
t.setBoard(true)
await sleep(250)
eq(t.boardColumns().map((c) => c.ids), [['A'], ['D']], '看板不含未排期的 E')
const showBtn = q('[data-testid="show-unscheduled"]')
truthy(!!showBtn, '有被筛掉的未排期项时提示可切列表')
truthy((showBtn.textContent ?? '').includes('1'), `提示里带条数(实际「${showBtn.textContent}」)`)
showBtn.click()
await sleep(250)
eq(t.board(), false, '「未排期 N 项，切到列表」只切模式')
eq(titles(), ['A报告', 'D报告', 'E报告'], '切模式后条件与结果都不变')

/* ---------- 3) 与搜索 AND;repeat=none 只留一次性 ---------- */
await reset('today', false)
await setFilter(1, 'recurring')
t.setSearch('C报告')
await sleep(250)
eq(t.listRows().length, 0, '搜索与筛选取交集:不相交就是空')
t.setSearch('A报告')
await sleep(250)
eq(titles(), ['A报告'], '搜索与筛选命中同一条')
t.setSearch('')
await sleep(200)
await setFilter(1, 'none')
eq(titles(), ['B报告'], 'repeat=none 只留一次性任务')

/* ---------- 4) 选区只跟命中项走;隐藏项不被 Delete / 批量误伤 ---------- */
await reset('all', false)
await setFilter(1, 'all') // A,B,D,E,F(C 是中优先级)
eq(titles(), ['A报告', 'B报告', 'F报告', 'D报告', 'E报告'], '高优先级命中顺序(未排期在末位)')

t.select(['A', 'F'])
await sleep(80)
eq(t.selection().length, 2, '前置:已选 A/F')
await setFilter(1, 'none') // 只剩 B
eq(titles(), ['B报告'], '换条件后只剩 B')
eq(t.selection().length, 0, '被条件滤掉的选中项自动移出选区')

await setFilter(1, 'recurring')
key('a', { ctrlKey: true })
await sleep(150)
eq([...t.selection()].sort(), ['A', 'D', 'E', 'F'], 'Ctrl+A 只全选当前命中项')

// Shift 连选走命中行源:命中序列是 A,B,F,D,E(不含中优先级的 C)
await setFilter(1, 'all')
const checkOf = (id) => q(`[data-row="${id}"] .check input`)
checkOf('A').click()
await sleep(80)
checkOf('D').dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }))
await sleep(80)
eq([...t.selection()].sort(), ['A', 'B', 'D', 'F'], 'Shift 连选只在命中行内连选(不含 C)')

// 选中项被改成低优先级 → 移出命中 → Delete 不该动它
t.select(['A'])
await sleep(80)
await t.editTask('A', { prio: 3 })
await t.flush()
await sleep(250)
eq(t.selection().length, 0, '被隐藏的选中项已移出选区')
key('Delete')
await sleep(200)
eq(q('[data-testid="confirm-dialog"]'), null, '没有命中项时不弹删除确认')
eq(t.getState().todos.find((x) => x.id === 'A').status, 0, '隐藏的 A 不受 Delete 处理')

// 批量动作只作用于命中项(先把上一步为了造「隐藏选中项」而降级的 A 还原)
await t.editTask('A', { prio: 1 })
await t.flush()
await sleep(200)
await setFilter(1, 'all')
eq(titles(), ['A报告', 'B报告', 'F报告', 'D报告', 'E报告'], '前置:A 已还原为高优先级')
await setFilter(1, 'recurring') // A,D,E,F
key('a', { ctrlKey: true })
await sleep(150)
q('[data-testid="bulk-menu"]').click()
await sleep(150)
q('[data-bulk="tmr"]').click()
await t.flush()
await sleep(250)
eq(
  t.getState().todos.filter((x) => x.date === day(1)).map((x) => x.id).sort(),
  ['A', 'D', 'E', 'F'],
  '批量改期只命中当前筛选项'
)
eq(t.getState().todos.find((x) => x.id === 'C').date, todayStr, '未命中的 C 不受批量动作影响')

/* ---------- 4b) 重复任务在筛选下完成:生成下一条,命中项随之减少 ---------- */
await reset('today', false)
await setFilter(1, 'recurring')
eq(titles(), ['A报告', 'F报告'], '前置:今天只有 A/F')
t.select(['A'])
await sleep(80)
await t.complete('A')
await t.flush()
await sleep(250)
const spawned = t.todos().filter((x) => x.status === 0 && x.title === 'A报告')
eq(spawned.length, 1, '重复任务完成即生成下一条')
eq(t.selection().length, 0, '完成后 A 离开命中项,选区自动清空')
eq(titles(), ['F报告'], '当前筛选下只剩 F')

/* ---------- 5) 换侧栏视图重置筛选;同视图换模式保留;清筛选不动搜索 ---------- */
await reset('today', true)
await setFilter(1, 'recurring')
t.setBoard(false)
await sleep(250)
eq(prioPressed(1), true, '同视图切看板/列表保留筛选')
t.setView('all')
await sleep(250)
eq(prioPressed(1), false, '换侧栏视图重置筛选')
eq(q('[data-testid="filter-clear"]'), null, '重置后没有可清除的筛选')
t.setView('today')
await sleep(200)
await setFilter(1, 'all')
t.setSearch('B报告')
await sleep(250)
eq(t.listRows().length, 1, '前置:搜索已生效')
q('[data-testid="filter-clear"]').click()
await sleep(250)
eq(prioPressed(1), false, '「清除筛选」清掉两维条件')
eq(t.listRows().length, 1, '清除筛选不动搜索词')
t.setSearch('')
await sleep(150)

/* ---------- 6) 筛选下的真实拖拽:同列(可见序列 ≠ 完整桶) ---------- */
await reset('today', true)
// 完整桶顺序:B(1) → A(2) → F(3);筛「重复」后可见的只有 A、F
await t.editTask('B', { order: 1 })
await t.editTask('A', { order: 2 })
await t.editTask('F', { order: 3 })
await t.flush()
await sleep(200)
await setFilter(0, 'recurring')
// 可见序列是 A、C、F(中优先级的 C 也是日重复),而拖动只在高优先级桶内算下标
eq(t.boardColumns().map((c) => c.ids), [['A', 'C', 'F']], '前置:筛「重复」后今天可见 A/C/F')
const colToday = q(`[data-column="${todayStr}"] .content`)
truthy(!!colToday, '今天列存在')
await dragCard('F', colToday, q('[data-card="A"]').getBoundingClientRect().top + 2)
await q('[data-testid="filter-clear"]').click()
await sleep(250)
eq(bucketIds(todayStr, 1), ['B', 'F', 'A'], '落点映射到完整桶:B→F→A(不是 F→B→A)')

// 向上/向下都仍然「紧跟越过的卡」:不筛时可见序即完整桶
const colToday2 = q(`[data-column="${todayStr}"] .content`)
await dragCard('B', colToday2, q('[data-card="F"]').getBoundingClientRect().bottom - 2)
eq(bucketIds(todayStr, 1), ['F', 'B', 'A'], '向下拖紧跟被越过的卡')

/* ---------- 6b) 筛选下的跨日拖拽:目标全桶里藏着看不见的项 ---------- */
await reset('all', true)
const i = await t.newTask({ title: 'I报告', date: d8, prio: 1 })
await t.editTask('D', { order: 2 })
await t.editTask(i.id, { order: 1 })
await t.flush()
await sleep(250)
await setFilter(0, 'recurring') // 可见:A、F(今天)+ D(8 天后);I(一次性)与 B 隐藏
const col8 = q(`[data-column="${d8}"] .content`)
truthy(!!col8, '8 天后那一列存在')
await dragCard('A', col8, q('[data-card="D"]').getBoundingClientRect().top + 2)
await q('[data-testid="filter-clear"]').click()
await sleep(250)
eq(bucketIds(d8, 1), [i.id, 'A', 'D'], '目标全桶 I→A→D(隐藏的 I 也算进下标)')
eq(bucketIds(todayStr, 1), ['B', 'F'], '源列无关隐藏项相对顺序不变')

/* ---------- 7) 导出:当前视图吃筛选,「全部」不吃且不含已完成/回收站 ---------- */
await reset('today', true)
await setFilter(1, 'recurring')
t.openExport()
await sleep(250)
const dlgText = q('[data-testid="export-dialog"]').textContent.replace(/\s+/g, ' ')
truthy(dlgText.includes('共 2 条'), `有筛选的当前视图 = 2 条(实际「${dlgText}」)`)
q('[data-testid="export-csv"]').click()
await t.flush()
await sleep(400)
const csvToast = q('[data-testid="toast"]')?.textContent ?? ''
truthy(csvToast.includes('已筛选'), `有筛选的导出件名带「已筛选」(实际「${csvToast}」)`)

t.openExport()
await sleep(250)
const scopeSel = q('[data-testid="export-scope"]')
scopeSel.value = 'all'
scopeSel.dispatchEvent(new Event('change'))
await sleep(150)
const allText = q('[data-testid="export-dialog"]').textContent.replace(/\s+/g, ' ')
truthy(allText.includes('共 6 条'), `「全部」= 六个未完成项(实际「${allText}」)`)
q('[data-testid="export-csv"]').click()
await t.flush()
await sleep(400)

return { today: todayStr, d8, dragOrder: bucketIds(todayStr, 1), csvToast }
