// 步骤 40:就地快捷录入(工具区第一行)+ 统一新建预设
//
// 覆盖:Enter/按钮等价、IME 选词不提交、空白不提交、去首尾空白、收集箱=未排期、
// 清单/看板列的预设日期与清单、详细编辑转交草稿、刷新后仍在、输入框内粘贴不触发批量。
const t = window.__todoTest
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const pad = (n) => String(n).padStart(2, '0')
const d = new Date()
const day = (n) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`
}
const todayStr = day(0)
const tmr = day(1)

const q = (sel) => document.querySelector(sel)
const keys = (el, k, opts = {}) =>
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }))
const key = (k, opts = {}) => keys(window, k, opts)
const type = (el, text) => {
  el.value = text
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
const quickInput = () => q('[data-testid="quick-title"]')
const addBtn = () => q('[data-testid="quick-add"]')

await t.importJson(JSON.stringify({ groups: [], lists: [], todos: [] }))
await t.flush()
t.setBoard(true)
t.setView('tmr')
t.setSearch('')
await sleep(250)

// 1) 空白与 IME:都不该新增
truthy(!!quickInput(), '快捷录入输入框已渲染')
eq(addBtn().disabled, true, '标题为空时「添加」禁用')
type(quickInput(), '   ')
keys(quickInput(), 'Enter')
await sleep(80)
eq(t.todos().length, 0, '空白标题 Enter 不新建')

type(quickInput(), '明日计划')
const ime = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
Object.defineProperty(ime, 'isComposing', { value: true })
quickInput().dispatchEvent(ime)
await sleep(80)
eq(t.todos().length, 0, 'IME 选词中的 Enter 不新建')

// 2) 真 Enter:恰好一条、去空白、日期=明天、ACTIVE、prio 2、输入框清空并重新获焦
type(quickInput(), '  明日计划  ')
keys(quickInput(), 'Enter')
await t.flush()
await sleep(150)
eq(t.todos().length, 1, 'Enter 恰好新增一条')
const one = t.todos()[0]
eq(one.title, '明日计划', '标题已去首尾空白')
eq(one.date, tmr, '日期 = 明天(与「明天」视图预设一致)')
eq(one.status, 0, '状态 ACTIVE')
eq(one.prio, 2, '默认优先级 2')
eq(one.repeat.kind, 'none', '默认不重复')
eq(quickInput().value, '', '成功新建后输入框清空')
eq(document.activeElement, quickInput(), '清空后重新获得焦点')
const okToast = q('[data-testid="toast"]')?.textContent ?? ''
truthy(okToast.includes('已添加') && !okToast.includes('不可见'), `可见的新建只提示「已添加」(实际「${okToast}」)`)

// 3) 切视图/切看板列表:草稿不丢
type(quickInput(), '跨视图草稿')
t.setBoard(false)
await sleep(150)
t.setView('today')
await sleep(150)
t.setView('week7')
await sleep(150)
eq(quickInput().value, '跨视图草稿', '切看板/列表与视图后草稿仍在')
type(quickInput(), '')

// 4) 待办视图之外不显示工具区 —— 但布局不能塌:视图区要有确定高度(虚拟滚动靠它),
//    状态栏也不能被挤到 overflow:hidden 的 main 外面去
for (const v of ['done', 'dropped', 'trash']) {
  t.setView(v)
  await sleep(150)
  eq(q('[data-testid="task-tools"]'), null, `${v} 视图隐藏快捷录入`)
  const statusBox = q('[data-testid="statusbar"]').getBoundingClientRect()
  truthy(
    statusBox.bottom <= window.innerHeight + 1 && statusBox.top > window.innerHeight * 0.7,
    `${v} 视图状态栏仍贴在底部(实际 ${Math.round(statusBox.top)}..${Math.round(statusBox.bottom)} / ${window.innerHeight})`
  )
  const bodyBox = q('[data-testid="body"]').getBoundingClientRect()
  truthy(
    bodyBox.height > 150 && bodyBox.bottom <= statusBox.top + 1,
    `${v} 视图视图区高度确定且不与状态栏重叠(实际 ${Math.round(bodyBox.height)})`
  )
}
t.setView('tmr')
await sleep(150)

// 5) 收集箱 = 未排期:空态新建 / 顶栏新建 / N 键 / 快捷添加 四条入口一致
t.setView('inbox')
await sleep(200)
truthy(
  (q('[data-testid="quick-preset"]').textContent ?? '').includes('未排期'),
  `收集箱预设提示应含「未排期」(实际「${q('[data-testid="quick-preset"]').textContent}」)`
)

// 空态入口要趁收集箱还空着测:一添加就没有空态了
t.setBoard(false)
await sleep(200)
q('[data-testid="list-empty-new"]').click()
await sleep(150)
eq(t.dialog().presetDate, '', '列表空态新建的预设日期为空')
q('[data-testid="dlg-cancel"]').click()
await sleep(120)
t.setBoard(true)
await sleep(200)
q('[data-testid="empty-new"]').click()
await sleep(150)
eq(t.dialog().presetDate, '', '看板空态新建的预设日期为空')
q('[data-testid="dlg-cancel"]').click()
await sleep(120)

q('[data-testid="new-task"]').click()
await sleep(150)
eq(t.dialog().presetDate, '', '顶栏新建的预设日期为空')
eq(q('[data-testid="dlg-nodate"]').checked, true, '完整弹窗「不排期」已勾上')
q('[data-testid="dlg-cancel"]').click()
await sleep(120)

key('n')
await sleep(150)
eq(t.dialog().presetDate, '', 'N 键新建的预设日期为空')
q('[data-testid="dlg-cancel"]').click()
await sleep(120)

type(quickInput(), '随手记一条')
await sleep(80) // 等 Vue 更新 disabled 绑定:同步点 disabled 按钮的 click() 会被浏览器吞掉
addBtn().click()
await t.flush()
await sleep(150)
const inboxItem = t.todos().find((x) => x.title === '随手记一条')
truthy(!!inboxItem, '「添加」按钮与 Enter 等价')
eq(inboxItem.date, '', '收集箱里快捷添加 = 未排期')

// 6) 清单视图:预设清单 = 当前清单;看板列新建保留清单、列日期覆盖预设
await t.addList('', '清单甲', '#3A7AFE')
await t.flush()
const lid = t.lists()[0].id
t.setView(`list:${lid}`)
await sleep(250)
type(quickInput(), '清单里的任务')
keys(quickInput(), 'Enter')
await t.flush()
await sleep(150)
const inList = t.todos().find((x) => x.title === '清单里的任务')
eq(inList.lid, lid, '清单视图快捷添加落在当前清单')
eq(inList.date, todayStr, '清单视图预设日期 = 今天')

await t.newTask({ title: '明日任务', date: tmr, prio: 2, lid })
await t.flush()
await sleep(250)
q(`[data-add="${todayStr}"]`).click()
await sleep(150)
eq(t.dialog().presetList, lid, '看板列新建保留当前清单')
eq(t.dialog().presetDate, todayStr, '看板列新建用该列日期')
q('[data-testid="dlg-cancel"]').click()
await sleep(120)
q(`[data-add="${tmr}"]`).click()
await sleep(150)
eq(t.dialog().presetDate, tmr, '列日期覆盖预设(预设是今天,该列是明天)')
eq(t.dialog().presetList, lid, '覆盖日期时清单不被清掉')
q('[data-testid="dlg-cancel"]').click()
await sleep(120)

// 7) 详细编辑接过草稿;保存并新建后标题为空
t.setView('week7')
await sleep(200)
type(quickInput(), '草稿标题')
q('[data-testid="quick-details"]').click()
await sleep(180)
eq(t.dialog().presetTitle, '草稿标题', '详细编辑把草稿交给弹窗')
eq(q('[data-testid="dlg-title"]').value, '草稿标题', '弹窗标题初值 = 草稿')
eq(quickInput().value, '', '转交后工具区草稿已清空')
q('[data-testid="dlg-save-new"]').click()
await t.flush()
await sleep(200)
truthy(
  t.todos().some((x) => x.title === '草稿标题'),
  '保存并新建落盘草稿标题'
)
eq(q('[data-testid="dlg-title"]').value, '', '保存并新建后新一轮标题为空')
eq(quickInput().value, '', '工具区草稿仍为空')
q('[data-testid="dlg-cancel"]').click()
await sleep(120)

// 8) 刷新后数据仍在
const before = t.todos().length
await t.flush()
await t.reload()
await sleep(250)
eq(t.todos().length, before, '刷新后条数不变')
const again = t.todos().find((x) => x.id === one.id)
truthy(!!again, '刷新后快捷录入的 id 仍在')
eq(again.date, tmr, '刷新后日期仍是明天')
eq(again.prio, 2, '刷新后优先级仍是 2')

// 9) 被搜索排除时:任务照建,反馈可「查看」,Esc 不动搜索
t.setView('week7')
t.setSearch('绝不匹配的词')
await sleep(250)
eq(t.listRows().length, 0, '搜索把现有任务都挡在外面(前置条件)')
type(quickInput(), '被搜索挡住的任务')
keys(quickInput(), 'Enter')
await t.flush()
await sleep(250)
const hidden = t.todos().find((x) => x.title === '被搜索挡住的任务')
truthy(!!hidden, '搜索不匹配时任务仍被创建')
truthy(
  (q('[data-testid="toast"]')?.textContent ?? '').includes('不可见'),
  `反馈应说明当前条件下不可见(实际「${q('[data-testid="toast"]')?.textContent}」)`
)
truthy(!!q('[data-testid="toast-action"]'), '反馈带「查看」动作')
q('[data-testid="toast-action"]').click()
await sleep(220)
eq(t.dialog()?.id, hidden.id, '「查看」打开刚建的任务')
q('[data-testid="dlg-cancel"]').click()
await sleep(150)

type(quickInput(), '临时草稿')
keys(quickInput(), 'Escape')
await sleep(150)
eq(quickInput().value, '', 'Esc 先清掉本地草稿')
eq(t.listRows().length, 0, 'Esc 未顺手清掉搜索词')
t.setSearch('')
await sleep(150)

// 10) 输入框内的粘贴走原生,不触发全局「按行批量新建」
const dt = new DataTransfer()
dt.setData('text', '粘贴甲\n粘贴乙')
quickInput().dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
await t.flush()
await sleep(200)
eq(t.todos().filter((x) => x.title === '粘贴甲').length, 0, '输入框内粘贴不触发全局批量新建')
eq(t.todos().filter((x) => x.title === '粘贴乙').length, 0, '输入框内粘贴不触发全局批量新建(第二行)')

/* ---------- 11) 弹窗焦点:初始聚焦 / Tab 圈定 / Esc 还焦点 / 热键不穿透 ---------- */
t.setSearch('')
t.setBoard(false)
t.setView('week7')
await sleep(250)
type(quickInput(), '焦点用例')
const detailsBtn = q('[data-testid="quick-details"]')
detailsBtn.focus()
detailsBtn.click()
await sleep(250)
const dlgTitle = q('[data-testid="dlg-title"]')
truthy(!!dlgTitle, '详细编辑打开了任务弹窗')
eq(document.activeElement, dlgTitle, '弹窗打开后焦点落在标题输入框')
eq(dlgTitle.selectionStart, '焦点用例'.length, '草稿光标在末尾(可以接着往下写)')

// Tab 圈定:Shift+Tab 从第一个控件回绕到最后一个,连续 Tab 也出不去
dlgTitle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }))
await sleep(120)
eq(document.activeElement, q('[data-testid="dlg-save"]'), 'Shift+Tab 从首个控件回绕到最后一个')
for (let i = 0; i < 14; i++) {
  document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
}
await sleep(150)
truthy(
  q('[data-testid="task-dialog"]').querySelector('.dialog').contains(document.activeElement),
  '连续 Tab 之后焦点仍在弹窗内'
)

// 弹窗开着时:Ctrl+F / B / N / F5 都不作用于背景
window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true }))
await sleep(150)
truthy(
  q('[data-testid="task-dialog"]').contains(document.activeElement),
  `弹窗开着时 Ctrl+F 焦点不离开弹窗(实际 ${document.activeElement.dataset.testid})`
)
const boardBefore = t.board()
key('b')
await sleep(120)
eq(t.board(), boardBefore, '弹窗开着时 B 不切换看板/列表')
key('n')
await sleep(150)
eq(t.dialog()?.presetTitle, '焦点用例', '弹窗开着时 N 不会另开一个弹窗')
key('F5')
await sleep(250)
truthy(
  !(q('[data-testid="toast"]')?.textContent ?? '').includes('已刷新'),
  '弹窗开着时 F5 不刷新'
)

// Esc:只关这一层,焦点还给触发控件
key('Escape')
await sleep(250)
eq(q('[data-testid="task-dialog"]'), null, 'Esc 关掉弹窗')
eq(document.activeElement, detailsBtn, '关闭后焦点回到触发控件')
const focusRestored = document.activeElement === detailsBtn

/* ---------- 12) 叠层顺序按 z-index:Confirm(110) 压住 Export(105) ---------- */
t.setBoard(false)
t.setView('all')
t.setSearch('')
await sleep(250)
const rowId = t.listRows()[0]?.id
truthy(!!rowId, '列表里有可用行')
t.select([rowId])
await sleep(80)
key('Delete')
await sleep(250)
const confirmEl = q('[data-testid="confirm-dialog"]')
truthy(!!confirmEl, 'Delete 弹二次确认')
eq(confirmEl.querySelector('.dialog').getAttribute('aria-modal'), 'true', '确认框是最上面的模态')
eq(document.activeElement, q('[data-testid="confirm-cancel"]'), '确认框初始焦点在「取消」')

// 再开一层 z-index 更低的:不能抢走模态与焦点
t.openExport()
await sleep(250)
eq(q('[data-testid="confirm-dialog"] .dialog').getAttribute('aria-modal'), 'true', '叠层后仍是最上面那层模态')
eq(q('[data-testid="export-dialog"] .dialog').getAttribute('aria-modal'), null, '被压住的导出面板不是模态')
truthy(q('[data-testid="export-dialog"]').hasAttribute('inert'), '被压住的导出面板 inert')
truthy(!q('[data-testid="confirm-dialog"]').hasAttribute('inert'), '最上面的确认框不 inert')
truthy(q('[data-testid="confirm-dialog"] .dialog').contains(document.activeElement), '焦点留在最上面的确认框里')

key('Escape')
await sleep(250)
eq(q('[data-testid="confirm-dialog"]'), null, 'Esc 只关最上面一层(确认框)')
truthy(!!q('[data-testid="export-dialog"]'), '导出面板仍开着')
truthy(
  q('[data-testid="export-dialog"] .dialog').contains(document.activeElement),
  '关闭后焦点落进新的顶层(导出面板)'
)
key('Escape')
await sleep(250)
eq(q('[data-testid="export-dialog"]'), null, '再一次 Esc 关掉导出面板')

/* ---------- 12b) 先开 Export(105) 再开 Settings(100):顶层看 z-index,不看挂载顺序 ---------- */
t.openExport()
await sleep(250)
t.openSettings()
await sleep(250)
eq(q('[data-testid="export-dialog"] .dialog').getAttribute('aria-modal'), 'true', '先开的导出(105)仍是顶层')
eq(q('[data-testid="settings-dialog"] .dialog').getAttribute('aria-modal'), null, '后开的设置(100)不抢顶层')
truthy(q('[data-testid="settings-dialog"]').hasAttribute('inert'), '被压住的设置面板 inert')
truthy(q('[data-testid="export-dialog"] .dialog').contains(document.activeElement), '焦点留在导出面板里')
key('Escape')
await sleep(250)
eq(q('[data-testid="export-dialog"]'), null, 'Esc 关掉最上面的导出面板')
truthy(q('[data-testid="settings-dialog"] .dialog').contains(document.activeElement), '焦点落进新的顶层(设置)')
key('Escape')
await sleep(250)
eq(q('[data-testid="settings-dialog"]'), null, '再一次 Esc 关掉设置')

/* ---------- 13) 保存并新建:新弹窗的焦点不被旧实例抢走 ---------- */
key('n')
await sleep(250)
const title1 = q('[data-testid="dlg-title"]')
truthy(!!title1 && document.activeElement === title1, 'N 打开的弹窗聚焦标题')
type(title1, '连录一条')
await sleep(80)
q('[data-testid="dlg-save-new"]').click()
await t.flush()
await sleep(300)
const title2 = q('[data-testid="dlg-title"]')
truthy(!!title2, '保存并新建后弹窗仍在')
eq(title2.value, '', '新一轮标题为空')
eq(document.activeElement, title2, '焦点在新弹窗的标题上,没被旧实例抢走')
key('Escape')
await sleep(200)

/* ---------- 14) 原生控件上的 Enter/Space/方向键不兼职任务快捷键 ---------- */
t.setBoard(false)
t.setView('all')
await sleep(250)
const target = t.listRows()[0]?.id
truthy(!!target, '列表里有可用行')
const targetPrio = t.getState().todos.find((x) => x.id === target).prio
q(`[data-filter-prio="${targetPrio}"]`).click()
await sleep(200)
t.select([target])
await sleep(80)
const allBtn = q('[data-filter-prio="0"]')
truthy(!!allBtn, '有「全部」优先级按钮')
allBtn.focus()
for (const k of ['Enter', ' ', 'ArrowDown', 'ArrowLeft']) {
  allBtn.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
}
await sleep(200)
eq(t.dialog(), null, '原生按钮上的 Enter/Space 不会打开选中任务')
eq(t.board(), false, '原生按钮上的导航键不会切换视图')
eq(t.selection(), [target], '原生按钮上的 ↓ 不会移动选中行')
q('[data-testid="filter-clear"]').click()
await sleep(150)

/* ---------- 15) 输入法选词中的 Esc 与侧栏语义 ---------- */
type(quickInput(), '输入法草稿')
const imeEsc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
Object.defineProperty(imeEsc, 'isComposing', { value: true })
quickInput().dispatchEvent(imeEsc)
await sleep(120)
eq(quickInput().value, '输入法草稿', 'IME 选词中的 Esc 不处理(草稿还在)')
type(quickInput(), '')
await t.addGroup('可折叠分组')
await t.flush()
await sleep(200)
const arrow = document.querySelector('[data-arrow]')
truthy(!!arrow && arrow.tagName === 'BUTTON', '折叠箭头是原生按钮')
eq(arrow.getAttribute('aria-expanded'), 'true', '折叠箭头带 aria-expanded')
arrow.click()
await sleep(150)
eq(arrow.getAttribute('aria-expanded'), 'false', '折叠后 aria-expanded 跟着变')

return { total: t.todos().length, quickId: one.id, hiddenId: hidden.id, lid, focusRestored }
