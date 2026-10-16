/** 界面状态(视图 / 搜索 / 弹窗 / 提示) */
import { reactive } from 'vue'
import { LIST_COLORS, type ViewKey } from '@shared/types'
import { DEFAULT_TASK_FILTER, filterActive, type ListSort, type TaskFilter } from '@shared/query'

export interface TaskDialogState {
  mode: 'new' | 'edit'
  id?: string
  presetDate?: string
  presetList?: string
  /** 快捷录入「详细编辑」转交过来的草稿标题(普通新建/编辑不设) */
  presetTitle?: string
  /** 每次打开自增:TaskDialog 在 setup 里取一次性快照,改值不重挂载就按 N 没反应。
   *  组件用 :key="ui.dialog.seq" 强制重挂。 */
  seq: number
}

export interface ConfirmState {
  title: string
  detail: string
  onOk: () => void
  secondary?: { label: string; onOk: () => void }
}

/** 底部提示:一个短文本 + 可选动作按钮(如删除后的「撤销」) */
export interface ToastState {
  text: string
  action?: { label: string; run: () => void }
}

/** 分组/清单的新建与重命名弹窗(TaskDialog 的同款快照语义,靠 seq 强制重挂) */
export interface MetaState {
  mode: 'new-group' | 'edit-group' | 'new-list' | 'edit-list'
  /** 编辑模式的目标 id */
  id?: string
  /** 新建清单时的默认所属分组 */
  gid?: string
  name: string
  color: string
  seq: number
}

export const ui = reactive({
  view: 'week7' as ViewKey,
  search: '',
  searchOpen: false,
  board: true,
  dialog: null as TaskDialogState | null,
  /** 分组/清单新建与重命名弹窗;null = 关闭 */
  meta: null as MetaState | null,
  settingsOpen: false,
  helpOpen: false,
  /** 从备份恢复面板;null 语义由 false 表达 */
  backupOpen: false,
  /** 导出 Markdown / CSV 面板 */
  exportOpen: false,
  confirm: null as ConfirmState | null,
  /** 底部提示;null = 不显示。可带一个动作按钮(删除后的「撤销」) */
  toast: null as ToastState | null,
  /** 侧栏分组展开状态(手动收起的分组不被切视图自动展开) */
  collapsed: {} as Record<string, boolean>,
  /** 任务卡右键菜单位置;null = 关闭 */
  cardMenu: null as { id: string; x: number; y: number } | null,
  /** 列表列排序;null = 默认顺序(日期→优先级→清单→seq) */
  listSort: null as ListSort | null,
  /**
   * 看板/列表的两维筛选。只活在本次会话里(切侧栏视图会重置,重启不恢复):
   * 它是「现在想看什么」的临时视角,不是数据。
   */
  taskFilter: { ...DEFAULT_TASK_FILTER } as TaskFilter,
  /** 看板横向滚动请求:seq 自增触发 BoardView 的 watch(方向键用,滚动宽度只有它知道) */
  boardScroll: { delta: 0, seq: 0 }
})

let toastTimer: number | undefined
let dialogSeq = 0
let metaSeq = 0

export function toast(message: string, action?: ToastState['action']): void {
  ui.toast = { text: message, action }
  clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => {
    ui.toast = null
  }, 4000)
}

/** 立即收起提示(动作按钮点完就走) */
export function hideToast(): void {
  clearTimeout(toastTimer)
  ui.toast = null
}

export function requestNew(preset?: { date?: string; list?: string; title?: string }): void {
  ui.dialog = {
    mode: 'new',
    presetDate: preset?.date,
    presetList: preset?.list,
    presetTitle: preset?.title,
    seq: ++dialogSeq
  }
}

export function requestEdit(id: string): void {
  ui.dialog = { mode: 'edit', id, seq: ++dialogSeq }
}

export function closeDialog(): void {
  ui.dialog = null
}

export function askConfirm(
  title: string,
  detail: string,
  onOk: () => void,
  secondary?: ConfirmState['secondary']
): void {
  ui.confirm = { title, detail, onOk, secondary }
}

export function openCardMenu(id: string, x: number, y: number): void {
  ui.cardMenu = { id, x, y }
}

export function closeCardMenu(): void {
  ui.cardMenu = null
}

/** 分组新建/重命名弹窗 */
export function requestNewGroup(): void {
  ui.meta = { mode: 'new-group', name: '', color: LIST_COLORS[0] as string, seq: ++metaSeq }
}

/** 分组重命名;名字由调用方从 store 取好传入(ui.ts 不读 store,避免与 data.ts 循环依赖) */
export function requestEditGroup(id: string, name: string): void {
  ui.meta = { mode: 'edit-group', id, name, color: LIST_COLORS[0] as string, seq: ++metaSeq }
}

/** 清单新建;gid 与 color 由调用方按当前视图与空闲色算好 */
export function requestNewList(gid: string, color: string): void {
  ui.meta = { mode: 'new-list', gid, name: '', color, seq: ++metaSeq }
}

export function requestEditList(id: string, name: string, gid: string, color: string): void {
  ui.meta = { mode: 'edit-list', id, gid, name, color, seq: ++metaSeq }
}

export function closeMeta(): void {
  ui.meta = null
}

/** 清掉两维筛选(整体换新对象,与其余状态同款不可变风格);不动搜索词 */
export function resetTaskFilter(): void {
  ui.taskFilter = { ...DEFAULT_TASK_FILTER }
}

/** 有搜索词或两维筛选在生效:空结果该给「新建」还是「清除条件」全看它 */
export function hasTaskConditions(): boolean {
  return ui.search.trim() !== '' || filterActive(ui.taskFilter)
}

/** 空结果里的「清除搜索和筛选」:两样一起清,不留半截条件 */
export function clearTaskConditions(): void {
  ui.search = ''
  resetTaskFilter()
}

/** 看板左右滚动一列(delta 为 ±1);整体替换对象,保持不可变风格 */
export function boardScrollBy(delta: number): void {
  ui.boardScroll = { delta, seq: ui.boardScroll.seq + 1 }
}
