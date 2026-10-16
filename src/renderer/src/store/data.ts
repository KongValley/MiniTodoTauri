/**
 * 唯一数据源。state.store 只在 commit 里整体替换,组件不直接改字段(不可变)。
 *
 * store 用 markRaw 包住:整棵任务树的字段级追踪从未被依赖(改动一律整体替换),
 * 而深代理会让每次字段读取都过 Proxy —— 5000 条实测 22 次视图计数从 1.4 ms 涨到 113 ms。
 * 派生数据统一由 store/index.ts 的 index computed 提供。
 */
import { markRaw, reactive } from 'vue'
import { emptyStore, mergeStore, removeTodos, trashExpiredIds } from '@shared/store-ops'
import { VIEWS, type Store, type ViewKey } from '@shared/types'
import { CH } from '@shared/api'
import { refreshSettings, settingsState, type Settings } from './settings'
import { askConfirm, toast, ui } from './ui'

export const state = reactive({
  store: markRaw(emptyStore()) as Store,
  path: '',
  warning: '',
  settings: null as Settings | null,
  ready: false,
  /** 上一次保存失败:数据只留在内存,状态栏持续显示直到下一次保存成功 */
  saveFailed: false
})

type SaveResult = { ok: boolean; error?: string }

/** 最近一次保存的 Promise,供冒烟的 flush() 等待落盘 */
let pending: Promise<SaveResult> = Promise.resolve({ ok: true })

/** 最近一次变更前的 store 快照(仅内存、一步);见 undoLast */
let undoSnapshot: Store | null = null

/** 等到「当前在飞的写盘 + 还没排到的变更」都落盘。冒烟大量依赖它,语义必须等于旧版「等最近一次保存」。 */
export async function flush(): Promise<unknown> {
  while (queued || dirty !== null) {
    await flushDirty()
  }
  return pending
}

/**
 * 唯一的 store 写入点。必须 markRaw:store-ops 的纯函数每次返回**新的普通对象**,
 * 直接塞进 reactive 会被重新深代理(既丢掉读取性能,也让返回值无法结构化克隆)。
 */
function setStore(next: Store): void {
  state.store = markRaw(next)
}

/** 待落盘的最新一版 store;null = 没有待写内容 */
let dirty: Store | null = null
/** 当前这一批的落盘 Promise;null = 没有在飞的写盘 */
let inFlight: Promise<SaveResult> | null = null
/** 本批落盘已排队(setTimeout 宏任务) */
let queued = false

/**
 * 同一帧内多次变更只落盘最后一版。
 *
 * 为什么是宏任务(setTimeout 0)而不是微任务:微任务在 Vue 渲染前就跑完,起不到合并作用;
 * 0 ms 宏任务会把同一个事件循环里连续发生的变更(批量完成、Ctrl+A 后连删)吃进同一批。
 * 序列化只在这里做一次 —— 传对象要结构化克隆 7.5 万个对象(85ms),传字符串只要 7ms。
 */
function scheduleSave(next: Store): void {
  dirty = next
  if (queued) return
  queued = true
  setTimeout(flushDirty, 0)
}

/** 把最新一版写盘(若有)。主进程从不 reject,失败只体现在 ok —— 不看它就等于把丢数据藏起来。 */
function flushDirty(): Promise<SaveResult> {
  queued = false
  const snapshot = dirty
  dirty = null
  if (snapshot === null) return inFlight ?? pending
  const save = window.todoAPI.invoke(CH.storeSave, JSON.stringify(snapshot)) as Promise<SaveResult>
  inFlight = save
  pending = save
  const settle = (): void => {
    if (inFlight === save) inFlight = null
  }
  void save.then(
    (res) => {
      settle()
      state.saveFailed = !res.ok
      if (!res.ok) toast(`保存失败：${res.error ?? '未知原因'}`)
    },
    (e: unknown) => {
      settle()
      state.saveFailed = true
      toast(`保存失败：${e instanceof Error ? e.message : String(e)}`)
    }
  )
  return save
}

/** 纯函数式改数据:mutate(s => addTodo(s, {...})) */
export async function mutate(fn: (s: Store) => Store): Promise<void> {
  const before = state.store
  const next = fn(before)
  // 只存引用(零拷贝):撤销窗口是「刚做完的那一步」,删除类操作弹 toast 时才暴露给用户
  if (next !== before) undoSnapshot = before
  await commit(next)
}

/**
 * 唯一的 store 写入点：替换内存中的 store，并把落盘排进本帧末尾。
 *
 * 刻意**不 await 磁盘往返** —— 同帧内连续变更（批量完成、连点勾选）因此只写盘一次，
 * 调用方也不必为 1 MB 载荷的往返买单。需要「已落盘」语义的调用点显式 `await flush()`。
 */
export function commit(next: Store): Promise<void> {
  setStore(next)
  scheduleSave(next)
  return Promise.resolve()
}

/**
 * 撤销最近一次变更(删除类操作的「撤销」按钮用)。
 * 只保留一步、只在内存里:够覆盖「手滑删了」这类场景,不值得做多级撤销栈。
 */
export async function undoLast(): Promise<boolean> {
  if (!undoSnapshot) return false
  const back = undoSnapshot
  undoSnapshot = null
  await commit(back)
  return true
}

/** 把当前 store 记为可撤销快照(导入/恢复在 commit 前调用;mutate 已在内部维护同一变量) */
export function captureUndo(): void {
  undoSnapshot = state.store
}

export async function reload(): Promise<void> {
  const res = (await window.todoAPI.invoke(CH.storeLoad)) as {
    ok: boolean
    store?: Store
    path?: string
    warning?: string
    error?: string
  }
  if (!res.ok || !res.store) throw new Error(res.error ?? '数据加载失败')
  setStore(res.store)
  state.path = res.path ?? ''
  state.warning = res.warning ?? ''
}

/**
 * 启动时恢复上次视图（settings.lastView）。
 * 内置视图直接采用；`list:`/`group:` 的 id 必须在当前 store 里存在，否则回退 week7。
 * 直接写 ui.view 而不走 setView：启动阶段不该回写一次设置。
 */
export function restoreLastView(): void {
  const v = settingsState.value.lastView
  if (!v) return
  if ((VIEWS as readonly string[]).includes(v)) {
    ui.view = v as ViewKey
    return
  }
  if (v.startsWith('list:')) {
    if (state.store.lists.some((l) => l.id === v.slice(5))) ui.view = v as ViewKey
    return
  }
  if (v.startsWith('group:')) {
    if (state.store.groups.some((g) => g.id === v.slice(6))) ui.view = v as ViewKey
  }
}

/**
 * 启动时静默清理回收站过期项（deletedAt 早于 TRASH_KEEP_DAYS 天）。
 * 不弹 toast：启动清理是维护动作，不是用户刚做的操作，没有「撤销」语义。
 */
export async function cleanupExpiredTrash(): Promise<number> {
  const ids = trashExpiredIds(state.store, Date.now())
  if (ids.length === 0) return 0
  await mutate((s) => removeTodos(s, ids, true))
  return ids.length
}

export async function init(): Promise<void> {
  await reload()
  state.settings = await refreshSettings()
  restoreLastView()
  await cleanupExpiredTrash()
  state.ready = true
}

/** 导入:选文件 → 备份 → 弹「替换 / 合并」,由用户决定后落盘 */
export async function importFromDialog(
  preset?: string
): Promise<{ ok: boolean; canceled?: boolean; pending?: boolean; error?: string }> {
  const res = (await window.todoAPI.invoke(CH.storeImport, preset)) as {
    ok: boolean
    canceled?: boolean
    store?: Store
    counts?: { groups: number; lists: number; todos: number }
    error?: string
  }
  if (!res.ok) return { ok: false, error: res.error }
  if (res.canceled || !res.store) return { ok: true, canceled: true }
  const incoming = res.store
  const c = res.counts ?? {
    groups: incoming.groups.length,
    lists: incoming.lists.length,
    todos: incoming.todos.length
  }
  askConfirm(
    '导入数据',
    `文件包含 ${c.groups} 个分组 / ${c.lists} 个清单 / ${c.todos} 条任务。\n「替换」会丢弃当前全部数据（当天已有一份自动备份，替换后还能点底部「撤销」回退）；「合并」保留现有任务，同 id 的条目跳过。`,
    () => {
      // 替换会丢弃当前全部数据:先记快照,导入后仍能一键回退
      captureUndo()
      void commit(incoming).then(() =>
        toast(`已替换：${c.groups} 分组 / ${c.lists} 清单 / ${c.todos} 任务`, {
          label: '撤销',
          run: () => void undoLast()
        })
      )
    },
    {
      label: '合并进当前数据',
      onOk: () => {
        const { store, skipped } = mergeStore(state.store, incoming)
        const s = skipped.groups + skipped.lists + skipped.todos
        captureUndo()
        void commit(store).then(() =>
          toast(s > 0 ? `已合并，跳过 ${s} 条重复` : '已合并', { label: '撤销', run: () => void undoLast() })
        )
      }
    }
  )
  return { ok: true, pending: true }
}

export async function exportToDialog(): Promise<{ ok: boolean; canceled?: boolean; path?: string; error?: string }> {
  const res = (await window.todoAPI.invoke(CH.storeExport, state.store)) as {
    ok: boolean
    canceled?: boolean
    path?: string
    error?: string
  }
  return res
}
