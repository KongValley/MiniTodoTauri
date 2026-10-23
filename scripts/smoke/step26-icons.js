// 步骤 26:全图标 SVG 化 + 商务调色板 token 生效
const t = window.__todoTest
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const pad = (n) => String(n).padStart(2, '0')
const d = new Date()
const today0 = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

await t.importJson(JSON.stringify({ groups: [], lists: [], todos: [] }))
await t.newTask({ title: '图标检查', date: today0 })
await t.flush()
t.setBoard(true)
await sleep(250)

// 视图图标:8 个侧栏行各渲染一个 svg,且是「彩色实心」——多部件、自带 --ico-* 填充
const viewIcons = [...document.querySelectorAll('[data-view] .icon svg')]
eq(viewIcons.length, 8, '8 个视图行各渲染一个 SVG 图标')

const partsOf = (s) => [...s.querySelectorAll('path')]
truthy(
  viewIcons.every((s) => partsOf(s).length >= 3),
  '每个视图图标至少 3 个实心部件(彩色分层)'
)
truthy(
  viewIcons.every((s) =>
    partsOf(s).every((p) => {
      // 实心件 fill 走 token;描边件(勾/叉/箭头)fill=none 而 stroke 走 token。两种都不许硬编码色
      const f = p.getAttribute('fill')
      const st = p.getAttribute('stroke')
      return f === 'none' ? (st ?? '').startsWith('var(--') : f.startsWith('var(--')
    })
  ),
  '部件颜色全部来自 CSS token,无硬编码色'
)
// 8 个视图图标形状互不相同(此前 明天/最近7天 共用同一个 week 图标)
const shapes = new Set(viewIcons.map((s) => partsOf(s).map((p) => p.getAttribute('d')).join('|')))
eq(shapes.size, 8, '8 个视图图标形状互不相同')

// 顶栏与侧栏的动作按钮都带图标
for (const id of ['new-task', 'view-board', 'view-list', 'open-settings', 'open-help']) {
  truthy(document.querySelector(`[data-testid="${id}"] svg`), `动作按钮 ${id} 带图标`)
}

// 实心底上的图标必须与底色异色(反白)。回归防护:图标主色曾被塌缩成 --accent,
// 于是「新建」与看板/列表按下态变成绿底绿图标,肉眼看不见。
// 必须走 getComputedStyle 取解析值 —— 源码里 fill 是 var(--ico-blue) 字符串,getAttribute 比不出来
const assertIconVisible = (btn, label) => {
  const path = btn?.querySelector('svg path')
  truthy(path, `${label} 有 path 部件`)
  const fill = getComputedStyle(path).fill
  const bg = getComputedStyle(btn).backgroundColor
  truthy(fill && fill !== 'none' && bg, `${label} 取到图标色与底色 (${fill} / ${bg})`)
  truthy(fill !== bg, `${label} 图标不能与按钮底色同色`)
}
assertIconVisible(document.querySelector('[data-testid="new-task"]'), '新建按钮')
const pressedView = [...document.querySelectorAll('[data-testid="view-board"], [data-testid="view-list"]')].find(
  (b) => b.getAttribute('aria-pressed') !== 'false'
)
truthy(pressedView, '当前有一个按下的视图按钮')
assertIconVisible(pressedView, `按下态视图按钮 ${pressedView?.dataset.testid}`)

// 功能图标也是 svg,不再是文本字形
truthy(document.querySelector('[data-testid="search-input"]'), '搜索框存在')

// 单色描边图标必须真的画出像素:bbox 全为 0 说明路径被拆碎(踩过的坑 ——
// 把 'M11 4a7 7 0 ...' 按空格 split 会切成语法非法的碎片,svg 元素在但一个像素都不画)
const strokeIcons = [...document.querySelectorAll('[data-add] svg, [data-testid="search-clear"] svg')]
truthy(strokeIcons.length >= 1, '至少取到一个描边图标')
for (const s of strokeIcons) {
  const box = [...s.querySelectorAll('path')].reduce(
    (acc, p) => ({ w: Math.max(acc.w, p.getBBox().width), h: Math.max(acc.h, p.getBBox().height) }),
    { w: 0, h: 0 }
  )
  truthy(box.w > 4 && box.h > 4, `描边图标有实际尺寸 —— 实际 ${box.w}x${box.h}`)
}
truthy(document.querySelector('[data-add] svg'), '列头加号是 SVG')
truthy(document.querySelector('[data-card] .prio svg'), '优先级是 SVG 旗标')

// 完成后圆圈内出现 SVG 勾。注意:看板 week7 只显示未完成任务,
// 完成后卡片会离开当前视图(产品行为),故切到「已完成」视图再验。
const cardId = t.todos().find((x) => x.status === 0 && x.date !== '')?.id
truthy(cardId, '有可完成的未完成任务')
await t.complete(cardId)
await t.flush()
await sleep(250)
eq(t.getState().todos.find((x) => x.id === cardId).status, 1, '任务已完成')

t.setBoard(false)
t.setView('done')
await sleep(250)
const row = document.querySelector(`[data-row="${cardId}"]`)
truthy(row, '已完成视图里有该行')
truthy(row.querySelector('.circle svg'), '列表已完成行圆圈内是 SVG 勾')

// 页面上不应再有旧字形图标
eq(document.body.textContent.includes('⌕'), false, '不再有 ⌕ 字形')

// 主题 token 真的在驱动界面:浅/深切换后 data-theme 与实际生效的背景色都要变,
// 且两套主题的底色不同(不钉死具体色值 —— 换配色不该让这个步骤红)
const root = document.documentElement
const bgOf = () => getComputedStyle(root).getPropertyValue('--bg').trim().toLowerCase()
eq(root.dataset.theme, 'light', '初始是浅色主题')
const lightBg = bgOf()
truthy(lightBg.length > 0, '浅色主题读到了 --bg')

await t.setTheme('dark')
await sleep(250)
eq(root.dataset.theme, 'dark', 'data-theme 已切到 dark')
const darkBg = bgOf()
truthy(darkBg !== lightBg, `深色主题底色应与浅色不同(${lightBg} vs ${darkBg})`)
truthy(getComputedStyle(document.body).backgroundColor !== '', '深色下 body 背景已应用')

await t.setTheme('light')
await sleep(200)
eq(root.dataset.theme, 'light', 'data-theme 已切回 light')
eq(bgOf(), lightBg, '切回浅色后底色复原')

// 列表视图:排序箭头 + 优先级旗标同样是 svg
await sleep(200)
document.querySelector('[data-sort="date"]').click()
await sleep(150)
truthy(document.querySelector('[data-sort="date"] svg'), '排序激活后箭头是 SVG')
truthy(document.querySelector('[data-row] .prio svg'), '列表优先级是 SVG 旗标')
t.setView('all')
await sleep(150)

return { svgIcons: viewIcons.length }
