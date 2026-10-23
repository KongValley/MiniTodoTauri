// 步骤 20:任务卡右键菜单(改期 / 优先级 / Esc 关闭)
const t = window.__todoTest
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const pad = (n) => String(n).padStart(2, '0')
const d = new Date()
const day = (n) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}` }
const d1 = day(1)

await t.importJson(JSON.stringify({ groups: [], lists: [], todos: [] }))
const task = await t.newTask({ title: '菜单卡片', date: day(0), prio: 2 })
await t.flush()
t.setBoard(true)
await sleep(150)

const card = document.querySelector('[data-card="' + task.id + '"]')
truthy(card, '卡片已渲染')
card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 200, clientY: 200 }))
await sleep(150)
truthy(document.querySelector('[data-testid="card-menu"]'), '右键应弹菜单')
// 坐标夹取:菜单 left/top 应为像素值
truthy(document.querySelector('[data-testid="card-menu"]').style.left.endsWith('px'), '菜单已定位')

document.querySelector('[data-menu="改期到明天"]').click()
await t.flush()
await sleep(150)
const moved = t.getState().todos.find((x) => x.id === task.id)
eq(moved.date, d1, '菜单改期到明天生效')

card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 200, clientY: 200 }))
await sleep(120)
document.querySelector('[data-menu="高"]').click()
await t.flush()
await sleep(120)
eq(t.getState().todos.find((x) => x.id === task.id).prio, 1, '菜单改优先级生效')

// Esc 关闭(有确认框时应先关确认框,故此处无确认框)
card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 200, clientY: 200 }))
await sleep(120)
truthy(document.querySelector('[data-testid="card-menu"]'), '菜单再次打开')
window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
await sleep(120)
eq(document.querySelector('[data-testid="card-menu"]'), null, 'Esc 应关闭菜单')

// backdrop 点击关闭
card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 200, clientY: 200 }))
await sleep(120)
document.querySelector('[data-testid="card-menu-backdrop"]').click()
await sleep(120)
eq(document.querySelector('[data-testid="card-menu"]'), null, '点击 backdrop 应关闭菜单')

// 删除走确认:不直接删
card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 200, clientY: 200 }))
await sleep(120)
document.querySelector('[data-menu="删除"]').click()
await sleep(150)
truthy(document.querySelector('[data-testid="confirm-dialog"]'), '菜单删除应弹确认')
eq(t.getState().todos.find((x) => x.id === task.id).status, 0, '确认前未删除')
document.querySelector('[data-testid="confirm-cancel"]').click()
await sleep(120)
eq(t.getState().todos.find((x) => x.id === task.id).status, 0, '取消后仍未删除')

/* ---------- 右下角:菜单按实测尺寸钳制,不得越出视口 ---------- */
card.dispatchEvent(
  new MouseEvent('contextmenu', { bubbles: true, clientX: window.innerWidth - 6, clientY: window.innerHeight - 6 })
)
await sleep(200)
const cornerMenu = document.querySelector('[data-testid="card-menu"]')
truthy(cornerMenu, '右下角右键仍能开菜单')
const cr = cornerMenu.getBoundingClientRect()
truthy(
  cr.right <= window.innerWidth - 8 + 0.5 && cr.bottom <= window.innerHeight - 8 + 0.5,
  `菜单应被钳进视口 8px 内(实际 right=${cr.right.toFixed(1)}/${window.innerWidth}, bottom=${cr.bottom.toFixed(1)}/${window.innerHeight})`
)
truthy(
  (getComputedStyle(cornerMenu).maxHeight ?? '') !== 'none',
  '菜单有最大高度(超高时可滚)'
)
eq(getComputedStyle(cornerMenu).overflowY, 'auto', '菜单超高时纵向可滚')

/* ---------- 操作浮层的退出语义 ---------- */
t.setBoard(false)
await sleep(250)
const rowCheck = document.querySelector(`[data-row="${task.id}"] .check input`)
truthy(!!rowCheck, '列表行的勾选控件存在')
const rowEl = document.querySelector(`[data-row="${task.id}"]`)

// 焦点移出浮层即收起(不必等 Esc/点击),再开一次拿回焦点
rowCheck.focus()
await sleep(250)
eq(document.querySelector('[data-testid="card-menu"]'), null, '焦点移出浮层后自动收起')
rowEl.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 120, clientY: 120 }))
await sleep(250)
const escMenu = document.querySelector('[data-testid="card-menu"]')
truthy(!!escMenu, '列表行右键开菜单')
truthy(escMenu.contains(document.activeElement), '浮层打开后焦点在其第一个可用操作上')
window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
await sleep(250)
eq(document.querySelector('[data-testid="card-menu"]'), null, 'Esc 收起浮层')
eq(document.activeElement, rowCheck, 'Esc 收起后焦点回到触发控件')

// focusout:Tab 离开浮层即收起,且不把焦点拉回来
rowEl.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 120, clientY: 120 }))
await sleep(250)
const tabMenu = document.querySelector('[data-testid="card-menu"]')
truthy(!!tabMenu, '浮层再次打开')
const lastItem = [...tabMenu.querySelectorAll('button')].pop()
lastItem.focus()
await sleep(80)
// 模拟 Tab 把焦点搬到浮层外(浏览器默认行为),再让浮层感知
document.querySelector('[data-testid="search-input"]').focus()
await sleep(250)
eq(document.querySelector('[data-testid="card-menu"]'), null, '焦点离开浮层后自动收起')
truthy(document.activeElement !== rowCheck, '收起时不把焦点拉回触发控件(用户已点到别处)')

/* ---------- 从菜单转入弹窗:取消后焦点必须回到原来的任务控件 ---------- */
// 旧实现关菜单时把焦点连同菜单按钮一起摘掉,useDialogFocus 只能抓到 body,
// 取消后焦点就落到「新建」按钮 —— 这里要求它回到打开菜单的那一行
rowCheck.focus()
await sleep(120)
rowEl.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 120, clientY: 120 }))
await sleep(250)
document.querySelector('[data-menu="编辑"]').click()
await sleep(300)
truthy(document.querySelector('[data-testid="task-dialog"]'), '菜单「编辑」打开任务弹窗')
document.querySelector('[data-testid="dlg-cancel"]').click()
await sleep(300)
eq(document.querySelector('[data-testid="task-dialog"]'), null, '取消后任务弹窗关闭')
eq(document.activeElement, rowCheck, '菜单→编辑→取消后焦点回到原任务行')

rowCheck.focus()
await sleep(120)
rowEl.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 120, clientY: 120 }))
await sleep(250)
document.querySelector('[data-menu="删除"]').click()
await sleep(300)
truthy(document.querySelector('[data-testid="confirm-dialog"]'), '菜单「删除」弹出确认框')
document.querySelector('[data-testid="confirm-cancel"]').click()
await sleep(300)
eq(document.activeElement, rowCheck, '菜单→删除确认→取消后焦点回到原任务行')
eq(t.getState().todos.find((x) => x.id === task.id).status, 0, '取消删除后任务仍在')

return { rescheduled: d1, prio: 1, cornerRight: Math.round(window.innerWidth - cr.right) }

