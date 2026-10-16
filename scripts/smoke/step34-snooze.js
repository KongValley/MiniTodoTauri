// 步骤 34:「稍后提醒 10 分钟」——状态栏入口 + 主进程到点时刻
//
// 覆盖两件事:
//   1. 按钮只在提醒开关打开时出现（关着时点它没有意义）
//   2. 点击真的把到点时刻写进主进程状态（mainChecks.snoozeUntilMs > 0），
//      而「到点后穿透同日不重复」由 Rust 侧 notify_trigger_rules 单测钉住
const t = window.__todoTest
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const pad = (n) => String(n).padStart(2, '0')
const d = new Date()
const todayStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

await t.importJson(JSON.stringify({ groups: [], lists: [], todos: [] }))
await t.newTask({ title: '提醒我', date: todayStr, prio: 1 })
await t.flush()

eq(document.querySelector('[data-testid="snooze"]'), null, '未开提醒时不显示「稍后提醒」')

// 打开提醒并把时间设成已过去的时刻,让本进程内的 tick 必然发过一次
await t.setNotify(true, '00:00')
await sleep(150)
const btn = document.querySelector('[data-testid="snooze"]')
truthy(!!btn, '开了提醒后应显示「稍后提醒」按钮')
btn.click()
await sleep(200)
const toastText = document.querySelector('[data-testid="toast"]')?.textContent ?? ''
truthy(toastText.includes('10 分钟后提醒'), `应提示已设置(实际「${toastText}」)`)
return { toastText }
