// 步骤 15:窗口布局与渲染层可观测项(mainChecks 断言原生边框 / minSize)
// 侧栏宽度按布局契约(216px,窄窗口 192px)随窗口宽度变化,这里不再钉死具体像素,
// 只验证分区不重叠、顶栏/画布/底栏都落在视口内。
const t = window.__todoTest
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
eq(document.title, '迷你待办', '文档标题')
truthy(window.innerWidth >= 900, `内宽应 >= 900,实际 ${window.innerWidth}`)
truthy(window.innerHeight >= 600, `内高应 >= 600,实际 ${window.innerHeight}`)
const sidebar = document.querySelector('[data-testid="sidebar"]')
truthy(sidebar, '侧栏存在')
const main = document.querySelector('.main')
truthy(main, '主区存在')

const sb = sidebar.getBoundingClientRect()
const mb = main.getBoundingClientRect()
truthy(sb.width > 120 && sb.width < 320, `侧栏宽度应在紧凑区间内(实际 ${sb.width})`)
truthy(
  sb.right <= mb.left + 1 && mb.right <= window.innerWidth + 1,
  `侧栏与主区不重叠、整体不超出视口(侧栏 ${sb.left}..${sb.right} / 主区 ${mb.left}..${mb.right} / 视口 ${window.innerWidth})`
)

// WebView2 不暴露窗口外框尺寸（outerWidth == innerWidth），原生边框由 mainChecks 的 frameless 断言覆盖
truthy(window.outerWidth >= window.innerWidth, '外宽 >= 内宽')

// 画布与底栏必须完整落在视口内:工具区在三个状态视图消失时不能把画布挤没
const body = document.querySelector('[data-testid="body"]')
const status = document.querySelector('[data-testid="statusbar"]')
const bb = body.getBoundingClientRect()
const st = status.getBoundingClientRect()
truthy(bb.height > 150, `视图区应有确定高度(实际 ${bb.height})`)
truthy(
  bb.bottom <= st.top + 1 && st.bottom <= window.innerHeight + 1,
  `视图区与底栏贴底且不重叠(视图区底 ${bb.bottom} / 底栏 ${st.top}..${st.bottom} / 视口高 ${window.innerHeight})`
)

return {
  inner: [window.innerWidth, window.innerHeight],
  outer: [window.outerWidth, window.outerHeight],
  sidebar: [Math.round(sb.width), Math.round(mb.width)],
  bodyHeight: Math.round(bb.height)
}
