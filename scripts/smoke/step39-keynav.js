// 步骤 39:键盘导航 —— 列表 ↑↓ / Home / End(+Shift 连选)与看板 ←→ 滚列
//
// 覆盖三件容易错的事:
//   1. ↑↓ 必须在**未选中任何行**时也能起步(锚点为空时从第一行开始)
//   2. Shift+↑↓ 扩展选区且不移动锚点(再按一下应继续往外扩,不是从新行重新起算)
//   3. 移动后选中行要滚进视口(长列表下不能只改选中却看不见)
const t = window.__todoTest
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const pad = (n) => String(n).padStart(2, '0')
const d = new Date()
const day = (k) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + k)
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`
}

const ids = []
// 首次启动写入的是示例数据(12 条),先清空 —— 行序断言必须只面对本次造的数据
await t.importJson(JSON.stringify({ groups: [], lists: [], todos: [] }))
await t.flush()
for (let i = 0; i < 5; i++) {
  const x = await t.newTask({ title: `导航${i}`, date: day(i), prio: 3 })
  ids.push(x.id)
}
await t.flush()
t.setBoard(false)
t.setView('all')
await sleep(250)

const key = (k, opts = {}) =>
  window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }))

// 1) 未选中任何行时 ↑↓ 从第一行起步
t.select([])
await sleep(60)
const rows = t.listRows().map((r) => r.id)
key('ArrowDown')
await sleep(60)
eq(t.selection(), [rows[0]], `首次 ↓ 选第一行(模型行序 ${JSON.stringify(t.listRows())})`)
key('ArrowDown')
key('ArrowDown')
await sleep(80)
eq(t.selection(), [rows[2]], '↓ 两次后到第三行')

// 2) Shift+↓ 扩展选区,锚点不动
key('ArrowDown', { shiftKey: true })
await sleep(80)
eq(t.selection(), [rows[2], rows[3]], 'Shift+↓ 选中第三、四行')
key('ArrowDown', { shiftKey: true })
await sleep(80)
eq(t.selection(), [rows[2], rows[3], rows[4]], '再按一次继续往外扩(不是从新行重算)')

// 3) End / Home / ↑
key('End')
await sleep(60)
eq(t.selection(), [rows[4]], 'End 选中最后一行')
key('ArrowUp')
await sleep(60)
eq(t.selection(), [rows[3]], '↑ 上移一行')
key('Home')
await sleep(60)
eq(t.selection(), [rows[0]], 'Home 回到第一行')

// 4) 长列表里移动要真的滚动视口(选中行不能停在可视区之外)
await t.importJson(JSON.stringify({ groups: [], lists: [], todos: [] }))
const many = []
for (let i = 0; i < 60; i++) many.push({ id: `L${i}`, lid: '', title: `长列表${i}`, date: day(i % 6), prio: 2, seq: i })
await t.importJson(JSON.stringify({ groups: [], lists: [], todos: many }))
await t.flush()
await sleep(250)
const host = document.querySelector('.rows')
eq(host.scrollTop, 0, '起始未滚动')
for (let i = 0; i < 45; i++) key('ArrowDown')
await sleep(200)
truthy(host.scrollTop > 0, `45 次 ↓ 后应已滚动(实际 scrollTop=${host.scrollTop})`)
// 用实际几何判定,不再按行高硬编码(行高变了这套断言不会静默失效)
const selRow = document.querySelector(`[data-row="${t.selection()[0]}"]`)
truthy(selRow, '第 45 条选中行已渲染')
const rowRect = selRow.getBoundingClientRect()
const boxRect = host.getBoundingClientRect()
truthy(
  rowRect.top >= boxRect.top - 1 && rowRect.bottom <= boxRect.bottom + 1,
  `选中行应完整落在滚动容器可视区内(行 ${rowRect.top.toFixed(1)}..${rowRect.bottom.toFixed(1)} / 容器 ${boxRect.top.toFixed(1)}..${boxRect.bottom.toFixed(1)})`
)

// 5) 看板 ←→ 滚一列(列宽 300)
t.setBoard(true)
await sleep(300)
const cols = document.querySelector('[data-testid="board-columns"]')
const before = cols.scrollLeft
key('ArrowRight')
await sleep(200)
eq(cols.scrollLeft, before + 300, '→ 右移一列')
key('ArrowLeft')
await sleep(200)
eq(cols.scrollLeft, before, '← 回到原位')

return { firstRow: ids[0], listScrollTop: host.scrollTop, boardScroll: cols.scrollLeft }
