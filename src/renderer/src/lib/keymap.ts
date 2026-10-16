/**
 * 全局快捷键。结构照 pdf编辑器 的 useGlobalKeymap:
 * onMounted 挂 window keydown,onBeforeUnmount 摘掉。
 */
import { onBeforeUnmount, onMounted, nextTick } from 'vue'
import { addDays, today } from '@shared/dates'
import type { ViewKey } from '@shared/types'
import { reload, mutate, state, undoLast } from '../store/data'
import { updateSettings } from '../store/settings'
import { askConfirm, boardScrollBy, requestEdit, requestNew, resetTaskFilter, toast, ui } from '../store/ui'
import { addTodo, duplicateTodo, removeTodos } from '@shared/store-ops'
import { clearSelection, currentRowIds, moveSelection, selectAll, selectEdge, selectedIds } from './selection'
import { isComposingEvent, isTypingTarget } from './input-events'
import { actionPopoverOpen, closeTopDialog } from './dialog-focus'

/**
 * 新建时的预设日期与清单(与旧版 PresetList 行为一致)。
 * 「收集箱」视图里新建的是未排期任务,预设日期必须为空 —— 否则收集箱新建会立刻
 * 带着今天的日期跑掉(收集箱视图的判据就是 date === '')。
 */
export function newTaskPreset(): { date: string; list: string } {
  const view = ui.view
  const date = view === 'inbox' ? '' : view === 'tmr' ? addDays(today(), 1) : today()
  let list = ''
  if (view.startsWith('list:')) list = view.slice(5)
  else if (view.startsWith('group:')) {
    const gid = view.slice(6)
    list = state.store.lists.find((l) => l.gid === gid)?.id ?? ''
  }
  return { date, list }
}

export function setView(view: ViewKey): void {
  // 换视图 = 换语境,筛选跟着重置;同视图内切看板/列表不动它
  if (ui.view !== view) resetTaskFilter()
  ui.view = view
  clearSelection()
  // 记住上次视图（启动时由 data.ts 的 restoreLastView 还原）：这里是全应用唯一的视图收口
  void updateSettings({ lastView: view })
}

export function toggleBoard(): void {
  ui.board = !ui.board
}

/** 删除一律二次确认(单条也确认;回收站视图是彻底删除,文案点明不可恢复) */
function handleDelete(): void {
  if (selectedIds.size === 0) return
  const ids = [...selectedIds]
  const purge = ui.view === 'trash'
  askConfirm(
    purge ? '彻底删除' : '移入回收站',
    purge ? `将彻底删除 ${ids.length} 条任务，无法恢复。` : `将 ${ids.length} 条任务移入回收站。`,
    () => {
      void mutate((s) => removeTodos(s, ids, purge)).then(() => {
        toast(purge ? `已彻底删除 ${ids.length} 项` : `已移入回收站 ${ids.length} 项`)
        clearSelection()
      })
    }
  )
}

/** 剪贴板批量新建的上限:粘进一大段文本不该一次建出几千条任务 */
const PASTE_MAX = 200

/**
 * 剪贴板 → 批量新建任务(每行一条,空行跳过、首尾空白去掉)。
 * 输入框/文本域里走原生粘贴(用户是在编辑文本,不是在建任务);弹窗开着时不动作,
 * 否则会在用户看不见的列表后面静悄悄建一堆。
 */
function onPaste(event: ClipboardEvent): void {
  // 弹窗/浮层开着时不动作:否则会在用户看不见的列表后面静悄悄建一堆
  if (isTypingTarget(event.target) || hasOpenDialog() || actionPopoverOpen()) return
  const text = event.clipboardData?.getData('text') ?? ''
  const lines = text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s !== '')
  if (lines.length === 0) return
  event.preventDefault()
  const take = lines.slice(0, PASTE_MAX)
  const preset = newTaskPreset()
  void mutate((s) => take.reduce((acc, title) => addTodo(acc, { title, date: preset.date, lid: preset.list }), s)).then(
    () =>
      toast(`已从剪贴板新建 ${take.length} 条${lines.length > take.length ? `（超出 ${PASTE_MAX} 行已忽略）` : ''}`, {
        label: '撤销',
        run: () => void undoLast()
      })
  )
}

/** 七个弹窗标志:任意一个开着,全局快捷键都不该作用到背后的界面 */
function hasOpenDialog(): boolean {
  return (
    ui.dialog !== null ||
    ui.meta !== null ||
    ui.confirm !== null ||
    ui.settingsOpen ||
    ui.helpOpen ||
    ui.backupOpen ||
    ui.exportOpen
  )
}

/** 焦点在原生按钮/链接/下拉上:Enter、Space 与导航键属于那个控件的原生行为 */
function onNativeControl(target: EventTarget | null): boolean {
  // window/document 也可能是 target(脚本直发事件):它们没有 getAttribute
  if (!(target instanceof HTMLElement)) return false
  return (
    target.tagName === 'BUTTON' ||
    target.tagName === 'A' ||
    target.tagName === 'SELECT' ||
    target.tagName === 'SUMMARY' ||
    target.getAttribute('role') === 'button'
  )
}

export function useGlobalKeymap(): void {
  function onKeyDown(event: KeyboardEvent): void {
    // 已经有人处理过(弹窗/浮层会 stopPropagation 或 preventDefault),或正在输入法选词:不插手
    if (event.defaultPrevented || isComposingEvent(event)) return

    const ctrl = event.ctrlKey || event.metaKey
    const key = event.key.toLowerCase()
    const dialog = hasOpenDialog()
    const popover = actionPopoverOpen()

    // Ctrl+F:弹窗/浮层开着时不动作(否则焦点会被送到遮罩后面);已展开时也重新聚焦一次
    if (ctrl && key === 'f') {
      if (dialog || popover) return
      event.preventDefault()
      ui.searchOpen = true
      void nextTick(() => document.querySelector<HTMLInputElement>('[data-testid="search-input"]')?.focus())
      return
    }

    // Escape 从视觉最上层往下关(z-index:CardMenu 120 > Confirm 110 > dialog/settings/help 100)。
    // 浮层开着时整条 Esc 交给浮层自己(它会把焦点还给触发控件)——见 CardMenu/BulkMenu 的 window 监听。
    // 弹窗由 dialog-focus 统一认顶层;这里只剩搜索框要收。
    if (event.key === 'Escape') {
      if (actionPopoverOpen()) return
      if (closeTopDialog()) return
      if (ui.searchOpen) {
        ui.searchOpen = false
        ui.search = ''
      }
      return
    }

    // F5 在输入框聚焦时也要生效(旧行为):刷新是全局动作,顺带 preventDefault 掉 WebView 的整页重载。
    // 但弹窗/浮层开着时不动作 —— 那会在用户看不见的地方把数据整个换掉。
    if (event.key === 'F5') {
      if (dialog || popover) return
      event.preventDefault()
      void reload().then(() => toast('已刷新'))
      return
    }

    // 输入框聚焦时交还原生行为(否则打字会误触);Ctrl+A 仍保留输入框内的原生全选文本
    if (isTypingTarget(event.target)) return

    // 弹窗/浮层开着时,任务热键不作用于背景界面(F5 与 Ctrl+F 已在上面的分支里各自处理过)
    if (dialog || popover) return

    // 原生控件上的 Enter/Space/导航键:让那个控件自己去响应(不能顺手把选中任务也打开了)
    const native = onNativeControl(event.target)
    if (native && (event.key === 'Enter' || event.key === ' ' || event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End')) {
      return
    }

    // 列表视图全选当前视图;看板下无行源(currentRowIds 返回空)故不生效
    if (ctrl && key === 'a' && !ui.board) {
      event.preventDefault()
      const ids = currentRowIds()
      if (ids.length > 0) {
        selectAll(ids)
        toast(`已选 ${ids.length} 条`)
      }
      return
    }

    // 复制选中任务(限单选:多选会一次建出一堆,没有对应的批量入口)
    if (ctrl && key === 'd' && !ui.board && selectedIds.size === 1) {
      event.preventDefault()
      const id = [...selectedIds][0] as string
      void mutate((s) => duplicateTodo(s, id)).then(() => toast('已复制为一条新任务'))
      return
    }

    // 方向键:列表里移动选中行(Shift 连选),看板里左右滚动一列
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (ui.board) return
      event.preventDefault()
      moveSelection(event.key === 'ArrowDown' ? 1 : -1, event.shiftKey)
      return
    }
    if (event.key === 'Home' || event.key === 'End') {
      if (ui.board) return
      event.preventDefault()
      selectEdge(event.key === 'Home' ? 'first' : 'last', event.shiftKey)
      return
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      if (!ui.board) return
      event.preventDefault()
      boardScrollBy(event.key === 'ArrowLeft' ? -1 : 1)
      return
    }

    switch (event.key) {
      case 'n':
      case 'N': {
        const preset = newTaskPreset()
        requestNew(preset)
        return
      }
      case 'b':
      case 'B':
        toggleBoard()
        return
      case 'Delete':
        handleDelete()
        return
      case 'F2':
        if (selectedIds.size === 1) requestEdit([...selectedIds][0] as string)
        return
      case 'Enter':
        if (selectedIds.size === 1) requestEdit([...selectedIds][0] as string)
        return
      case '1':
        setView('today')
        return
      case '2':
        setView('tmr')
        return
      case '3':
        setView('week7')
        return
      case '4':
        setView('all')
        return
      default:
        return
    }
  }

  onMounted(() => {
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('paste', onPaste)
  })
  onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('paste', onPaste)
  })
}
