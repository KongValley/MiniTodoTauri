// 步骤 32:列表批量操作(完成/优先级/改期/移清单) + 删除撤销
//
// 覆盖三条最容易错的路径:
//   1. 每个动作必须真的作用于**全部**选中项(逐条 reduce,不是只改第一条)
//   2. 动作做完要清空选中并关掉菜单,否则第二次点击会作用在陈旧集合上
//   3. 删除后 4 秒内的「撤销」要把整棵 store 还原(包括彻底删除)
const t = window.__todoTest
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const pad = (n) => String(n).padStart(2, '0')
const d = new Date()
const day = (k) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + k)
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`
}

await t.importJson(
  JSON.stringify({
    groups: [],
    lists: [{ id: 'L1', gid: '', name: '批量清单', color: '#3A7AFE', order: 1 }],
    todos: []
  })
)
const a = await t.newTask({ title: 'b1', date: day(0), prio: 3, lid: 'L1' })
const b = await t.newTask({ title: 'b2', date: day(0), prio: 3, lid: 'L1' })
const c = await t.newTask({ title: 'b3', date: day(0), prio: 3, lid: 'L1' })
await t.flush()
t.setBoard(false)
t.setView('all')
await sleep(200) // 列表视图要等 Vue 挂载完才有工具条(看板模式下没有 [data-testid="bulk-menu"])

const ids = [a.id, b.id, c.id]
const openBulk = async () => {
  t.select(ids)
  await sleep(60)
  document.querySelector('[data-testid="bulk-menu"]').click()
  await sleep(60)
}

truthy(document.querySelector('[data-testid="bulk-menu"]').disabled === true, '无选中时批量按钮禁用')

// 1) 批量改优先级
await openBulk()
document.querySelector('[data-bulk="高"]').click()
await t.flush()
await sleep(80)
eq(t.todos().filter((x) => x.prio === 1).length, 3, '三条都改成高优先级')
eq(t.selection().length, 0, '动作后清空选中')

// 2) 批量改期到明天
await openBulk()
document.querySelector('[data-bulk="tmr"]').click()
await t.flush()
await sleep(80)
eq(t.todos().filter((x) => x.date === day(1)).length, 3, '三条都改到明天')

// 3) 批量移动到另一个清单
await t.addList('', '目标清单', '#3C9954')
await t.flush()
await openBulk()
const sel = document.querySelector('[data-testid="bulk-list"]')
sel.value = t.lists().find((l) => l.name === '目标清单').id
sel.dispatchEvent(new Event('change'))
await t.flush()
await sleep(80)
eq(t.todos().filter((x) => x.lid === sel.value).length, 3, '三条都移到目标清单')

// 4) 批量完成
await openBulk()
document.querySelector('[data-bulk="complete"]').click()
await t.flush()
await sleep(80)
eq(t.todos().filter((x) => x.status === 1).length, 3, '三条都标记完成')

// 5) 删除 + 撤销(整棵 store 还原)
await openBulk()
document.querySelector('[data-testid="delete-selected"]').click()
await sleep(120)
document.querySelector('[data-testid="confirm-ok"]').click()
await t.flush()
await sleep(150)
eq(t.todos().filter((x) => x.status === 3).length, 3, '三条已移入回收站(不是真删)')
const undoBtn = document.querySelector('[data-testid="toast-action"]')
truthy(!!undoBtn, '删除后应出现撤销按钮')
eq(undoBtn.textContent.trim(), '撤销', '按钮文案')
undoBtn.click()
await t.flush()
await sleep(150)
eq(t.todos().length, 3, '撤销把三条都带回来了')
eq(t.todos().filter((x) => x.status === 1).length, 3, '还原到删除前的状态(已完成)')
return { ids }
