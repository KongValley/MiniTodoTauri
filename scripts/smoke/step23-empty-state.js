// 步骤 23:空状态引导(看板 + 列表)
const t = window.__todoTest
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await t.importJson(JSON.stringify({ groups: [], lists: [], todos: [] }))
await t.flush()
t.setBoard(true)
await sleep(150)

const p = document.querySelector('.empty p')
truthy(p, '看板空状态有提示文案')
truthy((p.textContent ?? '').trim().length > 0, '无搜索词时也有非空提示(不逐字重钉)')
truthy(document.querySelector('[data-testid="empty-new"]'), '有新建入口')
truthy(document.querySelector('[data-testid="empty-import"]'), '有导入入口')
truthy(document.querySelector('[data-testid="empty-help"]'), '有快捷键入口')
eq(document.querySelector('[data-testid="board-today"]'), null, '空列时不显示「今天」浮动钮')

document.querySelector('[data-testid="empty-new"]').click()
await sleep(120)
eq(t.dialog() !== null, true, '点新建打开弹窗')
t.closeDialog()
await sleep(120)

document.querySelector('[data-testid="empty-help"]').click()
await sleep(120)
truthy(document.querySelector('[data-testid="help-dialog"]'), '点快捷键打开帮助')
t.closeDialog()

// 搜索无命中时空文案换成搜索相关,并给「清除搜索和筛选」而不是新建入口
t.setSearch('不存在的词')
await sleep(150)
truthy(document.querySelector('.empty p').textContent.includes('不存在的词'), '搜索无命中时文案提示搜索词')
eq(document.querySelector('[data-testid="empty-new"]'), null, '有搜索条件时不再把空结果说成「没有数据」')
const clearBtn = document.querySelector('[data-testid="clear-task-conditions"]')
truthy(!!clearBtn, '有搜索条件时给「清除搜索和筛选」')
clearBtn.click()
await sleep(200)
eq(document.querySelector('[data-testid="empty-new"]') !== null, true, '清除条件后回到「新建」入口')
eq(document.querySelector('.empty p').textContent.includes('不存在的词'), false, '清除条件后搜索词也清掉了')

// 列表视图同样有引导
t.setBoard(false)
await sleep(150)
truthy(document.querySelector('.empty p'), '列表空状态有提示文案')
truthy(document.querySelector('[data-testid="list-empty-new"]'), '列表有新建入口')
truthy(document.querySelector('[data-testid="list-empty-import"]'), '列表有导入入口')
truthy(document.querySelector('[data-testid="list-empty-help"]'), '列表有快捷键入口')

return { boardEmpty: true, listEmpty: true }
