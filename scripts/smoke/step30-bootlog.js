// 步骤 30:启动诊断日志(perf.log)——断言在 mainChecks.perfLog(见 run-smokes.mjs 断言表)
const t = window.__todoTest
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
await sleep(50)
truthy(document.querySelector('.shell'), '应用外壳已渲染')
truthy(t, '测试 API 可用')
return { ok: true }
