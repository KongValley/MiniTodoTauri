/// <reference types="vite/client" />

import type { TodoAPI } from '@shared/api'
import type { TodoTestAPI } from './test-api'

declare global {
  interface Window {
    todoAPI: TodoAPI
    __todoTest: TodoTestAPI
    /**
     * Tauri 全局 API（tauri.conf.json > app.withGlobalTauri）。
     * 只声明桥接层用到的部分；invoke 的 args 统一是 { args: [...] } 形状（见 lib/todo-api.ts）。
     */
    __TAURI__?: {
      core: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> }
      event: {
        listen: (name: string, cb: (e: { payload: unknown }) => void) => Promise<() => void>
      }
    }
  }
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}
