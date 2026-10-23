// 步骤 25:列表视图 Ctrl+A 全选当前视图;看板与输入框内不劫持
const t = window.__todoTest
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const pad = (n) => String(n).padStart(2, '0')
const d = new Date()
const today0 = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

await t.importJson(
  JSON.stringify({
    groups: [],
    lists: [],
    todos: [
      { id: 's1', lid: '', title: '第一条', date: today0, prio: 1 },
      { id: 's2', lid: '', title: '第二条', date: today0, prio: 2 },
      { id: 's3', lid: '', title: '第三条', date: today0, prio: 3 }
    ]
  })
)
await t.flush()
t.setBoard(false)
await sleep(150)

eq(t.selection().length, 0, '初始无选中')
window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true }))
await sleep(150)
eq(t.selection().length, 3, 'Ctrl+A 选中列表全部 3 行')
eq([...t.selection()].sort().join(','), ['s1', 's2', 's3'].join(','), '选中的正是当前 3 行')
truthy(document.querySelector('.toolbar')?.textContent.includes('已选 3 条'), '工具栏显示已选条数')

// 再按一次不改变数量(仍是全选)
window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true }))
await sleep(150)
eq(t.selection().length, 3, '重复 Ctrl+A 仍是全选')

// 切到看板:ListView 卸载即清选区 —— 看不见的行不进选区,批量动作才不会误伤
t.setBoard(true)
await sleep(150)
eq(t.selection().length, 0, '切到看板时选区被清掉(列表行已不可见)')
window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true }))
await sleep(150)
eq(t.selection().length, 0, '看板下 Ctrl+A 无效(没有行源)')

// 切回列表:原有的 onMounted 清空选择(LIST 视图挂载即重置选择)
t.setBoard(false)
await sleep(150)
eq(t.selection().length, 0, '切回列表视图后选择被重置(挂載即清空)')

// 重新全选
window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true }))
await sleep(150)
eq(t.selection().length, 3, '重新 Ctrl+A 全选')

// 输入框内 Ctrl+A 保留原生语义,不劫持(不从此处改变选择)
window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }))
await sleep(200)
const search = document.querySelector('[data-testid="search-input"]')
truthy(search, '搜索框常驻在顶栏,Ctrl+F 直接聚焦')
search.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true }))
await sleep(150)
eq(t.selection().length, 3, '输入框内 Ctrl+A 不改变选择(仍保持之前的全选结果)')

// Esc 清空查询,但搜索框常驻不消失(收起行为属于旧版已删除的交互)
window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
await sleep(150)
truthy(document.querySelector('[data-testid="search-input"]'), 'Esc 后搜索框仍在(常驻)')
eq(t.selection().length, 3, 'Esc 清搜索不影响列表选择')

return { selected: t.selection().length }
