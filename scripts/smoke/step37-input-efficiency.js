// 步骤 37:录入效率 —— 复制任务(Ctrl+D / 右键菜单)、剪贴板批量新建、保存并新建、右键移动到清单
const t = window.__todoTest
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const pad = (n) => String(n).padStart(2, '0')
const d = new Date()
const todayStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

await t.importJson(
  JSON.stringify({
    groups: [],
    lists: [{ id: 'L1', gid: '', name: '甲清单', color: '#3A7AFE', order: 1 }],
    todos: []
  })
)
const a = await t.newTask({ title: '原始任务', date: todayStr, prio: 1, lid: 'L1', note: '备注' })
await t.flush()
t.setBoard(false)
t.setView('all')
await sleep(200)

const rowOf = (id) => document.querySelector(`[data-row="${id}"]`)
const openMenu = async (id) => {
  rowOf(id).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 40 }))
  await sleep(120)
  return document.querySelector('[data-testid="card-menu"]')
}
const key = (k, opts = {}) =>
  window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }))

// 1) Ctrl+D 复制选中任务
t.select([a.id])
await sleep(60)
key('d', { ctrlKey: true })
await t.flush()
await sleep(150)
eq(t.todos().length, 2, 'Ctrl+D 复制出一条')
const byKey = t.todos().find((x) => x.id !== a.id)
eq(byKey.title, '原始任务', '复制件同标题')
eq(byKey.status, 0, '复制件是待办(不是已完成)')
eq(byKey.lid, 'L1', '复制件在同一清单')
eq(byKey.note, '备注', '备注照抄')

// 2) 右键菜单「复制任务」
truthy(!!(await openMenu(a.id)), '右键应弹出卡片菜单')
document.querySelector('[data-menu="复制任务"]').click()
await t.flush()
await sleep(150)
eq(t.todos().length, 3, '右键「复制任务」也复制出一条')
eq(document.querySelector('[data-testid="card-menu"]'), null, '动作后菜单关闭')

// 3) 剪贴板批量新建(每行一条,空行跳过、首尾空白 trim)
const dt = new DataTransfer()
dt.setData('text', '甲\n\n 乙 \n丙')
document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
await t.flush()
await sleep(200)
eq(t.todos().length, 6, '新建 3 条(空行被跳过)')
const titles = t.todos().map((x) => x.title)
truthy(titles.includes('甲') && titles.includes('乙') && titles.includes('丙'), '三条标题都建了(且已 trim)')
const pasteUndo = document.querySelector('[data-testid="toast-action"]')
truthy(!!pasteUndo, '批量新建应可撤销')
pasteUndo.click()
await t.flush()
await sleep(200)
eq(t.todos().length, 3, '撤销回到粘贴前的 3 条')

// 4) 保存并新建:弹窗不关,标题清空
key('n')
await sleep(150)
const titleInput = document.querySelector('[data-testid="dlg-title"]')
truthy(!!titleInput, '按 N 应打开新建弹窗')
titleInput.value = '连着录一条'
titleInput.dispatchEvent(new Event('input'))
await sleep(60)
document.querySelector('[data-testid="dlg-save-new"]').click()
await t.flush()
await sleep(200)
eq(t.todos().length, 4, '保存并新建落盘一条')
truthy(t.todos().some((x) => x.title === '连着录一条'), '新任务标题正确')
const stillOpen = document.querySelector('[data-testid="dlg-title"]')
truthy(!!stillOpen, '弹窗保持打开以便继续录')
eq(stillOpen.value, '', '标题输入框已清空')
document.querySelector('[data-testid="dlg-cancel"]').click()
await sleep(120)

// 5) 右键「移动到」另一个清单
await t.addList('', '乙清单', '#3C9954')
await t.flush()
await sleep(150)
await openMenu(a.id)
const sel = document.querySelector('[data-testid="card-menu-list"]')
const target = t.lists().find((l) => l.name === '乙清单').id
sel.value = target
sel.dispatchEvent(new Event('change'))
await t.flush()
await sleep(200)
eq(t.todos().find((x) => x.id === a.id).lid, target, '任务已移到乙清单')
truthy(
  (document.querySelector('[data-testid="toast"]')?.textContent ?? '').includes('乙清单'),
  '提示里带上目标清单名'
)

return { total: t.todos().length, target }
