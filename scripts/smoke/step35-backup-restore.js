// 步骤 35:每日自动备份 + 从备份恢复
//
// 钉住三件事(此前只挂在导入路径上,日常使用根本不产生备份 —— 本轮先修的就是这个):
//   1. 每次保存都会「按需」写一份备份 → 日常改动后 backups/ 里真的有一份
//   2. 当天只写一份(backup_if_due 去重)
//   3. 备份能恢复:替换后可用「撤销」回退,不会因为点错就丢数据
const t = window.__todoTest
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await t.importJson(
  JSON.stringify({
    groups: [],
    lists: [],
    todos: [
      { id: 'b1', lid: '', title: '备份甲', date: '', prio: 2, seq: 1 },
      { id: 'b2', lid: '', title: '备份乙', date: '', prio: 2, seq: 2 }
    ]
  })
)
await t.flush()
await sleep(120)

const a = await window.todoAPI.invoke('backups:list')
truthy(a.ok, 'backups:list 应返回 ok')
eq(a.items.length, 1, '日常保存后应存在一份备份(不是只有导入才写)')
truthy(a.items[0].ok, '备份应能解析')
eq(a.items[0].counts.todos, 2, '备份内容 = 保存时的 2 条')
truthy(a.items[0].mtimeMs > 0, '备份应有 mtime')
truthy(a.dir.includes('backups'), `备份目录应指向 backups(实际 ${a.dir})`)

// 再改一次数据:当天去重,仍只有一份
await t.newTask({ title: '备份丙', date: '', prio: 2 })
await t.flush()
await sleep(120)
const b = await window.todoAPI.invoke('backups:list')
eq(b.items.length, 1, '同一天不重复备份')
eq(b.items[0].counts.todos, 2, '备份仍是当天最早那份(2 条)')

// 数据长到 5 条,再从备份恢复
await t.newTask({ title: '备份丁', date: '', prio: 2 })
await t.newTask({ title: '备份戊', date: '', prio: 2 })
await t.flush()
eq(t.todos().length, 5, '恢复前 5 条')

t.openBackups()
await sleep(250)
truthy(!!document.querySelector('[data-testid="backup-dialog"]'), '应打开「从备份恢复」面板')
eq(document.querySelector('[data-testid="backup-empty"]'), null, '有备份时不该显示空提示')
const rows = [...document.querySelectorAll('[data-backup]')]
eq(rows.length, 1, '面板里列出 1 份备份')
eq(rows[0].dataset.backup, a.items[0].name, '列出的文件名与主进程一致')

document.querySelector('[data-testid="backup-restore"]').click()
await sleep(250)
truthy(!!document.querySelector('[data-testid="confirm-dialog"]'), '恢复要二次确认(替换/合并)')
document.querySelector('[data-testid="confirm-ok"]').click()
await t.flush()
await sleep(200)
eq(t.todos().length, 2, '恢复后回到备份里的 2 条')

const undoBtn = document.querySelector('[data-testid="toast-action"]')
truthy(!!undoBtn, '恢复后应出现「撤销」按钮')
undoBtn.click()
await t.flush()
await sleep(250)
eq(t.todos().length, 5, '撤销把替换前的 5 条带回来')
return { backups: b.items.length, dir: a.dir }
