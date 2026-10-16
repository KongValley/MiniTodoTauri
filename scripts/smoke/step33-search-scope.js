// 步骤 33:搜索范围扩展到子任务标题 / 清单名 / 分组名
//
// 覆盖:
//   1. 子任务标题能搜到（之前只有标题 + 备注）
//   2. 清单名与分组名能搜到 —— 命中来源不在行的可见文本里时不要求高亮，但必须出现在结果里
//   3. 无关词一条都不出（别把「命中变宽」写成「全部命中」）
const t = window.__todoTest
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await t.importJson(
  JSON.stringify({
    groups: [{ id: 'G1', name: '独特分组甲', order: 1 }],
    lists: [{ id: 'L1', gid: 'G1', name: '独特清单乙', color: '#3A7AFE', order: 1 }],
    todos: []
  })
)
const inList = await t.newTask({ title: '标题无关一', note: '', lid: 'L1' })
const withSub = await t.newTask({ title: '标题无关二', note: '', lid: '' })
await t.editTask(withSub.id, { subtasks: [{ id: 's1', title: '独特子任务丙', done: false }] })
await t.flush()

t.setBoard(false)
t.setView('all')
const search = async (q) => {
  t.setSearch(q)
  await sleep(80)
  return t.listRows().map((r) => r.id)
}

const subIds = await search('独特子任务丙')
eq(subIds.length, 1, '子任务标题应命中 1 条')
eq(subIds[0], withSub.id, '命中的是带该子任务的那条')

const listIds = await search('独特清单乙')
truthy(listIds.includes(inList.id), '清单名应命中其下任务')
eq(listIds.length, 1, '只命中该清单下的任务')

const groupIds = await search('独特分组甲')
truthy(groupIds.includes(inList.id), '分组名应命中组内清单的任务')
eq(groupIds.length, 1, '只命中该分组的任务')

eq((await search('完全不存在的词')).length, 0, '无关词一条都不出')

t.setSearch('')
await sleep(60)
eq(document.querySelectorAll('[data-row]').length >= 2, true, '清空搜索后两条都在')
return { subIds, listIds, groupIds }
