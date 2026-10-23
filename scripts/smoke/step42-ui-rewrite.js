// 步骤 42:紧凑效率型 UI 的新行为 —— 看板/列表双按钮、常显搜索、侧栏设置入口
//
// 覆盖三件旧实现做不到的事:
//   1) 视图切换按钮显式二选一:点当前视图不触发卸载,选择/草稿/筛选都保留
//   2) 搜索框常驻:不再需要先展开,Esc 清空并失焦,Ctrl+F 随时可聚焦
//   3) 设置/快捷键入口搬进侧栏底部,打开弹窗后 Esc 关闭并把焦点还给按钮
const t = window.__todoTest
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const pad = (n) => String(n).padStart(2, '0')
const d = new Date()
const day = (n) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`
}
const today0 = day(0)

const q = (sel) => document.querySelector(sel)
const keys = (el, k, opts = {}) =>
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }))
const key = (k, opts = {}) => keys(window, k, opts)
const imeKey = (el, k) => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })
  Object.defineProperty(e, 'isComposing', { value: true })
  el.dispatchEvent(e)
}
const type = (el, text) => {
  el.value = text
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
const pressed = (sel) => q(sel).getAttribute('aria-pressed')
const listRowIds = () => [...document.querySelectorAll('.list [data-row]')].map((el) => el.dataset.row)
const boardCardIds = (date) => [
  ...document.querySelectorAll(`[data-column="${date}"] [data-card]`)
].map((el) => el.dataset.card)
const quickInput = () => q('[data-testid="quick-title"]')

await t.importJson(
  JSON.stringify({
    groups: [{ id: 'gui', name: '工作', order: 0 }],
    lists: [{ id: 'lui', gid: 'gui', name: '界面重写', color: '#216949', order: 0 }],
    todos: [
      { id: 'uihigh', lid: 'lui', title: '界面 Alpha', date: today0, prio: 1 },
      { id: 'uilow', lid: 'lui', title: '常规 Beta', date: today0, prio: 3 }
    ]
  })
)
await t.flush()
t.setSearch('')
t.setBoard(true)
t.setView('list:lui')
await sleep(250)

/* ---------- 1) 看板/列表双按钮:显式二选一,点当前视图不丢状态 ---------- */
truthy(q('[data-testid="view-board"]'), '顶栏有看板按钮')
truthy(q('[data-testid="view-list"]'), '顶栏有列表按钮')
eq(q('[data-testid="view-board"]').getAttribute('aria-pressed'), 'true', '看板模式下看板按钮按下')
eq(q('[data-testid="view-list"]').getAttribute('aria-pressed'), 'false', '看板模式下列表按钮未按下')

type(quickInput(), '未提交草稿')
q('[data-filter-prio="1"]').click()
await sleep(200)
eq(q('[data-filter-prio="1"]').getAttribute('aria-pressed'), 'true', '高优先级筛选已选中')

q('[data-testid="view-list"]').click()
await sleep(250)
eq(pressed('[data-testid="view-list"]'), 'true', '切到列表后列表按钮按下')
eq(pressed('[data-testid="view-board"]'), 'false', '切到列表后看板按钮抬起')
eq(listRowIds(), ['uihigh'], `列表只显示高优先级任务(实际 ${JSON.stringify(listRowIds())})`)
eq(quickInput().value, '未提交草稿', '切视图后草稿仍在')

// 选中一行后点当前视图:不得清选择、不得重置筛选/草稿
t.select(['uihigh'])
await sleep(120)
q('[data-testid="view-list"]').click()
await sleep(250)
eq(t.selection(), ['uihigh'], '点击当前视图不清空选择')
eq(quickInput().value, '未提交草稿', '点击当前视图保留草稿')
eq(q('[data-filter-prio="1"]').getAttribute('aria-pressed'), 'true', '点击当前视图保留筛选')

q('[data-testid="view-board"]').click()
await sleep(300)
eq(pressed('[data-testid="view-board"]'), 'true', '切回看板后看板按钮按下')
eq(boardCardIds(today0), ['uihigh'], `看板当列只出现高优先级卡片(实际 ${JSON.stringify(boardCardIds(today0))})`)

/* ---------- 2) 搜索常驻:清空/焦点/Esc/Ctrl+F ---------- */
q('[data-testid="filter-clear"]').click()
await sleep(200)
// 行级断言要在列表视图里做,先切过去
q('[data-testid="view-list"]').click()
await sleep(250)
const search = q('[data-testid="search-input"]')
truthy(search, '搜索框常驻在顶栏(无需先展开)')

type(search, 'Alpha')
await sleep(250)
eq(listRowIds(), ['uihigh'], `搜索命中后列表只剩 Alpha(实际 ${JSON.stringify(listRowIds())})`)
q('[data-testid="search-clear"]').click()
await sleep(250)
eq(listRowIds(), ['uihigh', 'uilow'], '清除搜索后两项都回来')
eq(document.activeElement, search, '清除搜索后焦点留在搜索框')

type(search, 'Alpha')
await sleep(200)
imeKey(search, 'Escape')
await sleep(150)
eq(q('[data-testid="search-input"]').value, 'Alpha', 'IME 选词中的 Esc 不清空查询')

keys(search, 'Escape')
await sleep(200)
eq(q('[data-testid="search-input"]').value, '', 'Esc 清空查询')
truthy(q('[data-testid="search-input"]'), 'Esc 后搜索框仍在(常驻)')
truthy(document.activeElement !== q('[data-testid="search-input"]'), 'Esc 后焦点离开搜索框')

key('f', { ctrlKey: true })
await sleep(200)
eq(document.activeElement.dataset.testid, 'search-input', 'Ctrl+F 聚焦常驻搜索框')

/* ---------- 3) 侧栏设置/快捷键入口 + 焦点归还 ---------- */
for (const id of ['open-settings', 'open-help']) {
  const btn = q(`[data-testid="${id}"]`)
  truthy(btn, `侧栏底部有 ${id} 入口`)
  truthy(q('[data-testid="topbar"]').contains(btn) === false, `${id} 已从顶栏搬到侧栏`)
  btn.focus()
  btn.click()
  await sleep(250)
  truthy(q('[data-testid="settings-dialog"], [data-testid="help-dialog"]'), `${id} 打开了对应弹窗`)
  key('Escape')
  await sleep(250)
  eq(document.activeElement, btn, `${id} 弹窗 Esc 关闭后焦点回到该按钮`)
}

// 弹窗开着时 Ctrl+F 不把焦点送到背景搜索
q('[data-testid="quick-details"]').click()
await sleep(250)
truthy(q('[data-testid="task-dialog"]'), '详细编辑打开了任务弹窗')
key('f', { ctrlKey: true })
await sleep(200)
truthy(
  q('[data-testid="task-dialog"]').contains(document.activeElement),
  `弹窗开着时 Ctrl+F 焦点仍在弹窗内(实际 ${document.activeElement.dataset.testid})`
)
key('Escape')
await sleep(250)
eq(q('[data-testid="task-dialog"]'), null, 'Esc 关闭任务弹窗')

await t.flush()
return { viewport: [innerWidth, innerHeight], devicePixelRatio }
