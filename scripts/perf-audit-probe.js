// 性能审计探针:量「一次交互 → 首帧」的分段,以及落盘往返占了多少。
//
// 与 perf-probe.js 的分工:perf-probe 量「一次典型交互」的总墙钟(回归基线);
// 这里把同一个交互拆开,用来判断是不是命中了性能改动的目标:
//   syncMs          —— 触发到 mutate 返回(同步段:数据变换 + store 替换)
//   firstFrameMs    —— 同步段之后到第一帧(索引重建 + 渲染)
//   saveRoundTripMs —— 触发到 IPC 落盘返回(1 MB 载荷的那一段)
//   maxFrameGapMs   —— 一次保存期间主线程的最大帧间隔(>50ms 是长任务,用户能看见卡顿)
//
// 注入方式与 perf-probe.js 相同(smoke.rs 包进 async IIFE);末尾 return 结果。
const t = window.__todoTest
if (!t) throw new Error('测试 API 未安装')

const now = () => performance.now()
const r2 = (x) => Math.round(x * 100) / 100
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()))

const steps = []
async function step(label, action) {
  const t0 = now()
  const extra = await action()
  await nextFrame()
  steps.push({ label, wallMs: r2(now() - t0), ...(extra ?? {}) })
}

/** 采样 rAF 间隔;stop() 返回期间最长间隔 */
function frameGaps() {
  const gaps = []
  let last = now()
  let running = true
  const tick = () => {
    const c = now()
    gaps.push(c - last)
    last = c
    if (running) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
  return {
    stop() {
      running = false
      return { maxGapMs: gaps.length ? r2(Math.max(...gaps)) : 0, frames: gaps.length }
    }
  }
}

const total = t.todos().length
const activeWithDate = () =>
  t.todos().find((x) => x.status === 0 && x.date)?.id ?? t.todos().find((x) => x.status === 0)?.id
const activeCount = () => t.todos().filter((x) => x.status === 0).length

// 基线:一次「取整棵 store 并序列化」的成本(离线对比参考,不参与交互)
await step('基线:序列化成本', async () => {
  const s = now()
  const str = JSON.stringify(t.todos())
  return { stringifyTodosMs: r2(now() - s), bytes: str.length }
})

// 搜索:只走索引重建 + 渲染,不落盘 —— 交互成本的纯 CPU 上限
await step('搜索「任务标题 1」', async () => {
  const t0 = now()
  t.setSearch('任务标题 1')
  await nextFrame()
  const setToDomMs = r2(now() - t0)
  t.setSearch('')
  await nextFrame()
  return { setToDomMs, totalMs: r2(now() - t0) }
})

// 视图切换(看板 ↔ 列表)
await step('切换 看板→列表→看板', async () => {
  const t0 = now()
  t.setBoard(false)
  await nextFrame()
  const toListMs = r2(now() - t0)
  t.setBoard(true)
  await nextFrame()
  return { toListMs, toBoardMs: r2(now() - t0 - toListMs), rows: document.querySelectorAll('.list [data-row]').length, cards: document.querySelectorAll('.board [data-row]').length }
})

// 完成一条任务:同步段 / 首帧 / 落盘往返,以及保存期间主线程是否被饿死
await step('完成一条任务', async () => {
  const id = activeWithDate()
  const before = activeCount()
  const gaps = frameGaps()
  const t0 = now()
  const mut = t.complete(id)
  const syncMs = r2(now() - t0)
  await nextFrame()
  const firstFrameMs = r2(now() - t0)
  await mut
  const saveRoundTripMs = r2(now() - t0)
  const gap = gaps.stop()
  return { syncMs, firstFrameMs, saveRoundTripMs, ...gap, activeBefore: before, activeAfter: activeCount() }
})

// 拖拽改期(同一写路径,另一个调用点)
await step('拖拽改期一次', async () => {
  t.setView('week7')
  await nextFrame()
  const id = activeWithDate()
  const gaps = frameGaps()
  const t0 = now()
  const mut = t.moveCardToDate(id, '2030-06-01', 0)
  const syncMs = r2(now() - t0)
  await nextFrame()
  const firstFrameMs = r2(now() - t0)
  await mut
  const saveRoundTripMs = r2(now() - t0)
  const gap = gaps.stop()
  return { syncMs, firstFrameMs, saveRoundTripMs, ...gap, movedTo: t.todos().find((x) => x.id === id)?.date }
})

// 新建任务
await step('新建任务', async () => {
  const before = t.todos().length
  const t0 = now()
  const mut = t.newTask({ title: 'perf-audit', date: '2030-01-02', prio: 1 })
  const syncMs = r2(now() - t0)
  await nextFrame()
  const firstFrameMs = r2(now() - t0)
  await mut
  const saveRoundTripMs = r2(now() - t0)
  return { syncMs, firstFrameMs, saveRoundTripMs, added: t.todos().length - before }
})

// 连续三条:合并落盘的目标场景 —— 总耗时应远小于 3 × 单次往返
await step('连续完成 3 条', async () => {
  const ids = t.todos().filter((x) => x.status === 0 && x.date).slice(0, 3).map((x) => x.id)
  const before = activeCount()
  const t0 = now()
  await Promise.all(ids.map((id) => t.complete(id)))
  const doneMs = r2(now() - t0)
  await t.flush()
  return { threeDoneMs: doneMs, flushMs: r2(now() - t0 - doneMs), activeBefore: before, activeAfter: activeCount() }
})

// 纯落盘往返(不触发渲染):与单次交互的 saveRoundTripMs 对照
await step('纯保存往返(flush)', async () => {
  const t0 = now()
  await t.flush()
  return { flushMs: r2(now() - t0) }
})

// 列表滚动到底:虚拟滚动受益面
await step('切到列表并滚到底', async () => {
  t.setBoard(false)
  t.setSearch('')
  await nextFrame()
  const host = document.querySelector('.rows')
  const t0 = now()
  if (host) {
    host.scrollTop = host.scrollHeight
    await nextFrame()
  }
  return { scrollerFound: !!host, scrollMs: r2(now() - t0) }
})
t.setBoard(true)

return {
  total,
  domCards: document.querySelectorAll('[data-card]').length,
  domRows: document.querySelectorAll('[data-row]').length,
  domCols: document.querySelectorAll('[data-column]').length,
  steps
}
