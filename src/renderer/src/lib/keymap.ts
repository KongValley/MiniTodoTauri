/**
 * 全局快捷键。结构照 pdf编辑器 的 useGlobalKeymap:
 * onMounted 挂 window keydown,onBeforeUnmount 摘掉。
 */
import { onBeforeUnmount, onMounted } from 'vue'
import { addDays, today } from '@shared/dates'
import type { ViewKey } from '@shared/types'
import { reload, mutate, state, undoLast } from '../store/data'
import { updateSettings } from '../store/settings'
import { askConfirm, boardScrollBy, closeCardMenu, closeDialog, closeMeta, requestEdit, requestNew, toast, ui } from '../store/ui'
import { addTodo, duplicateTodo, removeTodos } from '@shared/store-ops'
import { clearSelection, currentRowIds, moveSelection, selectAll, selectEdge, selectedIds } from './selection'

export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable
}

/**
 * 中文输入法选词中的回车。Vue 的 withKeys 只比对 key,不带这个判断,
 * 选词那一下回车会被当成「保存」——而此时 v-model 还没拿到整段中文。
 */
export function isComposingEvent(e: KeyboardEvent): boolean {
  return e.isComposing || e.keyCode === 229
}

/** 新建时的预设日期与清单(与旧版 PresetList 行为一致) */
export function newTaskPreset(): { date: string; list: string } {
  const view = ui.view
  const date = view === 'tmr' ? addDays(today(), 1) : today()
  let list = ''
  if (view.startsWith('list:')) list = view.slice(5)
  else if (view.startsWith('group:')) {
    const gid = view.slice(6)
    list = state.store.lists.find((l) => l.gid === gid)?.id ?? ''
  }
  return { date, list }
}

export function setView(view: ViewKey): void {
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
  if (isTypingTarget(event.target) || ui.dialog || ui.confirm || ui.meta) return
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

export function useGlobalKeymap(): void {
  function onKeyDown(event: KeyboardEvent): void {
    const ctrl = event.ctrlKey || event.metaKey
    const key = event.key.toLowerCase()

    if (ctrl && key === 'f') {
      event.preventDefault()
      ui.searchOpen = true
      return
    }

    // Escape 从视觉最上层往下关(z-index:CardMenu 120 > Confirm 110 > dialog/settings/help 100)
    if (event.key === 'Escape') {
      if (ui.cardMenu) {
        closeCardMenu()
        return
      }
      if (ui.confirm) {
        ui.confirm = null
        return
      }
      if (ui.meta) {
        closeMeta()
        return
      }
      if (ui.dialog) {
        closeDialog()
        return
      }
      if (ui.settingsOpen) {
        ui.settingsOpen = false
        return
      }
      if (ui.helpOpen) {
        ui.helpOpen = false
        return
      }
      if (ui.searchOpen) {
        ui.searchOpen = false
        ui.search = ''
      }
      return
    }

    if (event.key === 'F5') {
      event.preventDefault()
      void reload().then(() => toast('已刷新'))
      return
    }

    // 输入框聚焦时交还原生行为(否则打字会误触);Ctrl+A 仍保留输入框内的原生全选文本
    if (isTypingTarget(event.target)) return

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
