// 步骤 38:导出 Markdown / CSV
//
// 系统保存对话框在冒烟里点不了,所以主进程侧由 TODO_SMOKE_EXPORT_DIR 注入目录(与
// TODO_SMOKE_SAVE_FAIL 同款探针)直写文件;字节级断言(BOM / 表头 / 行数 / md 不带 BOM)
// 由 run-smokes.mjs 在 Node 侧做 —— 渲染层读不了文件。
const t = window.__todoTest
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const pad = (n) => String(n).padStart(2, '0')
const d = new Date()
const todayStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

await t.importJson(
  JSON.stringify({
    groups: [],
    lists: [{ id: 'L1', gid: '', name: '导出清单', color: '#3A7AFE', order: 1 }],
    todos: []
  })
)
const withNote = await t.newTask({ title: '带备注的任务', note: '第一行\n第二行', date: todayStr, prio: 1, lid: 'L1' })
await t.addSubtask(withNote.id, '子项甲')
await t.toggleSubtask(withNote.id, t.todos().find((x) => x.id === withNote.id).subtasks[0].id)
await t.addSubtask(withNote.id, '子项乙')
await t.flush()
const done = await t.newTask({ title: '已完成的任务', date: todayStr, prio: 2 })
await t.complete(done.id)
await t.flush()
eq(t.todos().length, 2, '两条数据(一未完成一已完成)')

t.openExport()
await sleep(250)
truthy(!!document.querySelector('[data-testid="export-dialog"]'), '应打开导出面板')

// 范围「全部」+ 内容「含已完成」→ CSV(两条都在:一条未完成带备注子任务、一条已完成)
const scopeSel = document.querySelector('[data-testid="export-scope"]')
scopeSel.value = 'all'
scopeSel.dispatchEvent(new Event('change'))
const content = document.querySelector('[data-testid="export-content"]')
content.value = 'all'
content.dispatchEvent(new Event('change'))
await sleep(120)
const hint = document.querySelector('[data-testid="export-dialog"]').textContent.replace(/\s+/g, ' ')
truthy(hint.includes('共 2 条'), `「全部 + 含已完成」应为 2 条(实际「${hint}」)`)
document.querySelector('[data-testid="export-csv"]').click()
await t.flush()
await sleep(300)
const csvToast = document.querySelector('[data-testid="toast"]')?.textContent ?? ''
truthy(csvToast.includes('.csv'), `导出成功应提示路径(实际「${csvToast}」)`)
eq(document.querySelector('[data-testid="export-dialog"]'), null, '导出成功后面板自动关闭')

// 再导出 Markdown(回到默认:当前视图 + 仅未完成 → 只有那条未完成的)
t.openExport()
await sleep(200)
const mdHint = document.querySelector('[data-testid="export-dialog"]').textContent.replace(/\s+/g, ' ')
truthy(mdHint.includes('共 1 条'), `「当前视图 + 仅未完成」应为 1 条(实际「${mdHint}」)`)
document.querySelector('[data-testid="export-md"]').click()
await t.flush()
await sleep(300)
const mdToast = document.querySelector('[data-testid="toast"]')?.textContent ?? ''
truthy(mdToast.includes('.md'), `Markdown 导出成功应提示路径(实际「${mdToast}」)`)
eq(document.querySelector('[data-testid="export-dialog"]'), null, 'Markdown 导出后面板也关闭')

return { csvToast, mdToast, rows: t.todos().length }
