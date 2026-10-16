import type { TodoAPI } from '@shared/api'

/**
 * 桥接层：把原 Electron preload 暴露的 window.todoAPI 契约，原样实现到 Tauri 之上。
 * 渲染层其余代码（含 @shared/api 的通道常量）一行不改 —— 这里负责通道名到 Tauri 命令的映射。
 * 与 preload 版一致：invoke 永不 reject，失败一律返回 { ok:false, error }。
 */

const CMD: Record<string, string> = {
  'store:load': 'store_load',
  'store:save': 'store_save',
  'store:import': 'store_import',
  'store:export': 'store_export',
  'store:exportText': 'export_text',
  'store:openDir': 'store_open_dir',
  'backups:list': 'backups_list',
  'settings:load': 'settings_load',
  'settings:save': 'settings_save',
  'app:version': 'app_version',
  'app:quit': 'app_quit',
  'app:snooze': 'snooze'
}

async function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const t = window.__TAURI__
  if (!t) return { ok: false, error: 'Tauri API 不可用' }
  const cmd = CMD[channel]
  if (!cmd) return { ok: false, error: `未知通道: ${channel}` }
  try {
    return await t.core.invoke(cmd, { args })
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** 事件载荷约定：Rust 端 emit 的 payload 恒为「位置参数数组」，这里展开给回调 */
function on(channel: string, callback: (...args: unknown[]) => void): () => void {
  const t = window.__TAURI__
  if (!t) return () => {}
  let un: (() => void) | null = null
  void t.event
    .listen(channel, (e) => {
      const p = e.payload
      callback(...(Array.isArray(p) ? p : [p]))
    })
    .then((u) => {
      un = u
    })
  return () => {
    un?.()
  }
}

export function installTodoAPI(): void {
  const api: TodoAPI = { invoke, on }
  window.todoAPI = api
}
