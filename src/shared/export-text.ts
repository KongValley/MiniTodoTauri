/**
 * 导出为文本的唯一格式实现(纯函数,零 UI 依赖):Markdown 与 CSV 两份格式在这里定死。
 * 回收站项由调用方(导出面板)过滤 —— 导出里永远不出现已删除的任务。
 * CSV 的 UTF-8 BOM 由写盘侧(Rust)加:这是「Excel 打开中文不乱码」的唯一原因,
 * 格式函数保持纯文本,字节级单测才好写。
 */
import { DONE, PRIO_NAME, STATUS_NAME, type TodoItem } from './types'
import { label, stampLabel } from './dates'

const pad = (n: number): string => String(n).padStart(2, '0')

/** 'yyyy-MM-dd HH:mm'(本地时区) */
function stampFull(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 备注可以是多行,而 markdown 引用块一行装不下 → 折成单行 */
const oneLine = (s: string): string => s.replace(/\s*\n\s*/g, ' ')

/** 高/低优先级标注(中优先级是默认值,标了反而噪音) */
const prioMark = (p: TodoItem['prio']): string => (p === 1 ? '（高）' : p === 3 ? '（低）' : '')

/** 按 date 升序分组,未排期('')放最后 */
function groupByDate(rows: TodoItem[]): [string, TodoItem[]][] {
  const byDate = new Map<string, TodoItem[]>()
  for (const t of rows) {
    const arr = byDate.get(t.date)
    if (arr) arr.push(t)
    else byDate.set(t.date, [t])
  }
  const keys = [...byDate.keys()].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a < b ? -1 : 1))
  return keys.map((k) => [k, byDate.get(k) as TodoItem[]])
}

export function markdownOf(rows: TodoItem[], title: string, nowMs: number): string {
  const out: string[] = [`# 迷你待办 · ${title}`, '', `导出于 ${stampFull(nowMs)}，共 ${rows.length} 条。`]
  for (const [date, group] of groupByDate(rows)) {
    // 空行放在每组之前:文件末尾就只剩单个换行(空列表也不留空白块)
    out.push('')
    out.push(`## ${label(date)}`)
    for (const t of group) {
      out.push(`- [${t.status === DONE ? 'x' : ' '}] ${t.title}${prioMark(t.prio)}`)
      if (t.note !== '') out.push(`    > ${oneLine(t.note)}`)
      for (const s of t.subtasks) out.push(`    - [${s.done ? 'x' : ' '}] ${s.title}`)
    }
  }
  return out.join('\n') + '\n'
}

/** 字段一律双引号包裹、内部引号翻倍 —— 标题里的逗号/引号/换行都不会撑破列 */
const csvField = (v: string): string => `"${v.replace(/"/g, '""')}"`

export function csvOf(rows: TodoItem[], listNameOf: (lid: string) => string): string {
  const lines = ['状态,标题,日期,优先级,清单,备注,子任务,完成时间']
  for (const t of rows) {
    lines.push(
      [
        STATUS_NAME[t.status],
        t.title,
        t.date,
        PRIO_NAME[t.prio],
        listNameOf(t.lid),
        t.note,
        `${t.subtasks.filter((s) => s.done).length}/${t.subtasks.length}`,
        t.doneAt === null ? '' : stampLabel(t.doneAt)
      ]
        .map(csvField)
        .join(',')
    )
  }
  return lines.join('\r\n') + '\r\n'
}
