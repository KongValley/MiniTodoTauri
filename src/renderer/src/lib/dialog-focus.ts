/**
 * 弹窗的焦点管理(顶层判定 / 初始聚焦 / Tab 圈定 / Esc 关闭 / 关闭后恢复焦点)。
 *
 * 为什么要有「顶层」这个概念:设置(100)、备份/导出(105)、确认(110)可以叠着开,
 * 但键盘只该作用在最上面那层 —— 否则 Tab 会走进被压住的弹窗,Esc 会关错一个。
 * 顶层按所属 overlay 的实际 z-index 判定,同层则按 DOM 顺序(后出现的在上面),
 * **不按挂载顺序** —— 「保存并新建」会先挂新弹窗再卸旧弹窗,挂载顺序在这里是反的。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, type ComputedRef, type Ref } from 'vue'
import { isComposingEvent } from './input-events'

interface Entry {
  root: HTMLElement
  close: () => void
  initialFocus?: () => HTMLElement | null
  /** 打开弹窗前拿到焦点的控件:关闭后还回它 */
  trigger: HTMLElement | null
}

/** 已注册的弹窗(整体替换数组,保持不可变风格) */
const entries = ref<Entry[]>([])

/** 有任意弹窗开着:App 用它给 workspace 加 inert,避免 Tab 走到遮罩后面 */
export const hasModal: ComputedRef<boolean> = computed(() => entries.value.length > 0)

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

function isVisibleEnabled(el: HTMLElement): boolean {
  if ((el as HTMLButtonElement).disabled) return false
  if (el.closest('[inert]')) return false
  const st = getComputedStyle(el)
  return st.display !== 'none' && st.visibility !== 'hidden' && st.visibility !== 'collapse'
}

/** 弹窗内可聚焦控件(按 DOM 顺序);跳过 disabled / 隐藏项 */
function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(isVisibleEnabled)
}

/** 弹窗所属的遮罩层(z-index 挂在它身上) */
const overlayOf = (el: HTMLElement): HTMLElement => (el.closest('.overlay') as HTMLElement | null) ?? el

function isAbove(a: Entry, b: Entry): boolean {
  const ea = overlayOf(a.root)
  const eb = overlayOf(b.root)
  if (ea === eb) return false
  const za = Number(getComputedStyle(ea).zIndex) || 0
  const zb = Number(getComputedStyle(eb).zIndex) || 0
  if (za !== zb) return za > zb
  return (ea.compareDocumentPosition(eb) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
}

function topEntry(): Entry | null {
  let best: Entry | null = null
  for (const e of entries.value) if (best === null || isAbove(e, best)) best = e
  return best
}

/** 关掉最上面的弹窗;没有弹窗时返回 false(调用方据此决定要不要继续处理 Esc) */
export function closeTopDialog(): boolean {
  const top = topEntry()
  if (!top) return false
  top.close()
  return true
}

function focusInitial(entry: Entry): void {
  const target = entry.initialFocus?.() ?? focusables(entry.root)[0] ?? null
  if (target) target.focus()
  else entry.root.focus()
}

/** 关闭后把焦点还回去:优先还给触发控件,其次落回新建按钮 */
function restoreFocus(entry: Entry): void {
  const top = topEntry()
  const active = document.activeElement as HTMLElement | null
  // 焦点已经在新的顶层里(比如「保存并新建」自动聚焦了标题)就不再抢
  if (top && active && top.root.contains(active)) return
  if (top) {
    focusInitial(top)
    return
  }
  const t = entry.trigger
  // body 不算「有效触发控件」(N 键/菜单入口打开时 activeElement 就是 body):
  // 还给它等于焦点丢失,不如落到「新建」按钮上让键盘能继续用
  if (t && t !== document.body && t !== document.documentElement && t.isConnected && isVisibleEnabled(t)) {
    t.focus()
    return
  }
  const fallback = document.querySelector<HTMLElement>('[data-testid="new-task"]')
  fallback?.focus()
}

/** 卡片/批量浮层开着时,Esc 归浮层,弹窗不参与(浮层自己在键盘焦点里处理) */
export function actionPopoverOpen(): boolean {
  return document.querySelector('[data-testid="card-menu"], [data-testid="bulk-menu-panel"]') !== null
}

export function useDialogFocus(
  root: Ref<HTMLElement | null>,
  close: () => void,
  initialFocus?: () => HTMLElement | null
): { isTopmost: ComputedRef<boolean> } {
  const entry = ref<Entry | null>(null)
  const isTopmost = computed(() => {
    const e = entry.value
    return e !== null && entries.value.length > 0 && topEntry() === e
  })

  function onKeyDown(e: KeyboardEvent): void {
    if (!isTopmost.value) return
    if (isComposingEvent(e)) return

    if (e.key === 'Escape') {
      // 浮层在最上面时先让浮层收,弹窗这一层不动
      if (actionPopoverOpen()) return
      e.preventDefault()
      e.stopPropagation()
      close()
      return
    }

    if (e.key !== 'Tab') return
    const box = entry.value?.root
    if (!box) return
    const list = focusables(box)
    if (list.length === 0) {
      e.preventDefault()
      return
    }
    const first = list[0] as HTMLElement
    const last = list[list.length - 1] as HTMLElement
    const active = document.activeElement as HTMLElement | null
    if (e.shiftKey) {
      if (active === first || !box.contains(active)) {
        e.preventDefault()
        last.focus()
      }
    } else if (active === last || !box.contains(active)) {
      e.preventDefault()
      first.focus()
    }
  }

  onMounted(() => {
    const el = root.value
    if (!el) return
    // 根节点可聚焦:弹窗内没有可聚焦控件时焦点也有落处
    el.setAttribute('tabindex', '-1')
    const e: Entry = { root: el, close, initialFocus, trigger: document.activeElement as HTMLElement | null }
    entry.value = e
    // 先捕获触发控件再登记 —— hasModal 此刻才变 true,主界面不会在触发控件被记下前就 inert
    entries.value = [...entries.value, e]
    window.addEventListener('keydown', onKeyDown)
    void nextTick(() => {
      if (isTopmost.value) focusInitial(e)
    })
  })

  onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKeyDown)
    const e = entry.value
    if (!e) return
    entry.value = null
    entries.value = entries.value.filter((x) => x !== e)
    // 等本轮 DOM 变更(可能是「保存并新建」的新弹窗)落定后再决定焦点去哪
    void nextTick(() => restoreFocus(e))
  })

  return { isTopmost }
}
