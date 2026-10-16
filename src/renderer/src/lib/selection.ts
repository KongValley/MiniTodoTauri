/** 列表视图的多选状态(快捷键与组件共用) */
import { reactive } from 'vue'

export const selectedIds = reactive(new Set<string>())

export function clearSelection(): void {
  selectedIds.clear()
}

export function toggleSelection(id: string): void {
  if (selectedIds.has(id)) selectedIds.delete(id)
  else selectedIds.add(id)
}

export function setSelection(ids: string[]): void {
  selectedIds.clear()
  for (const id of ids) selectedIds.add(id)
}

export function selectAll(ids: string[]): void {
  setSelection(ids)
}

/**
 * 当前视图的可见行 id 源。由 ListView 注册/清空(它的行含分段头与排序,只有它知道)。
 * keymap 不 import 组件,故经此间接取;未注册时返回空数组(Ctrl+A 无效)。
 */
let rowSource: () => string[] = () => []

export function setRowSource(fn: () => string[]): void {
  rowSource = fn
}

export function currentRowIds(): string[] {
  return rowSource()
}

/**
 * Shift 连选的锚点(ListView 的鼠标点击与键盘移动共用同一份)。
 * 放在这里而不是组件内 ref:视图切换要清、键盘要读、鼠标要写,三处共用一个真相。
 */
let anchor: string | null = null
/** 选区端点(焦点行):Shift+↑↓ 移动的是它,锚点不动 —— 否则连按会一直得到同一段 */
let cursor: string | null = null

export function setAnchor(id: string | null): void {
  anchor = id
  cursor = id
}

export function getAnchor(): string | null {
  return anchor
}

/** 选中 anchor..id 的整段;anchor 不在 ids 里(切了视图)时退化为只选 id */
export function selectRange(ids: string[], id: string): void {
  const from = anchor === null ? -1 : ids.indexOf(anchor)
  const to = ids.indexOf(id)
  if (from < 0 || to < 0) {
    setSelection([id])
    setAnchor(id)
    return
  }
  const [lo, hi] = from < to ? [from, to] : [to, from]
  setSelection(ids.slice(lo, hi + 1))
  cursor = id
}

/** 行滚动钩子:只有 ListView 知道行高与滚动容器,键盘移动后由本模块转发(不传 fn 就摘掉) */
let rowScroll: (id: string) => void = () => {}

export function setRowScroll(fn: (id: string) => void): void {
  rowScroll = fn
}

/** ↑↓ 的移动入口。extend=true 时扩展选区且不移动 anchor;返回新选中的 id(无行时 null) */
export function moveSelection(delta: number, extend: boolean): string | null {
  const ids = currentRowIds()
  if (ids.length === 0) return null
  const base = cursor ?? anchor ?? [...selectedIds][0]
  // 一行都没选中时:↓ 落到第一行、↑ 落到最后一行(不能从第一行再往下多走一格)
  const idx =
    base === null || base === undefined
      ? delta > 0
        ? 0
        : ids.length - 1
      : Math.max(0, Math.min(ids.indexOf(base) + delta, ids.length - 1))
  const next = ids[idx] as string
  if (extend) {
    selectRange(ids, next)
  } else {
    setSelection([next])
    setAnchor(next)
  }
  rowScroll(next)
  return next
}

/** Home / End:跳到首 / 尾行 */
export function selectEdge(which: 'first' | 'last', extend: boolean): string | null {
  const ids = currentRowIds()
  if (ids.length === 0) return null
  const next = (which === 'first' ? ids[0] : ids[ids.length - 1]) as string
  if (extend) {
    selectRange(ids, next)
  } else {
    setSelection([next])
    setAnchor(next)
  }
  rowScroll(next)
  return next
}
