import { createApp } from 'vue'
import App from './App.vue'
import './assets/base.css'
import { installTestApi } from './test-api'
import { installTodoAPI } from './lib/todo-api'

declare global {
  interface Window {
    /** boot-fallback.js 的加载失败兜底标记:界面挂上就不再显示提示 */
    __booted?: boolean
  }
}

// 低配模式：老系统或小内存机器上关掉逐卡片阴影（唯一按项重复的合成开销）。
// deviceMemory 取量化桶（4GB 机器报 4），undefined 时按「不清楚」处理。
const nav = navigator as Navigator & { deviceMemory?: number }
const lowSpec =
  (nav.hardwareConcurrency || 8) <= 2 ||
  (nav.deviceMemory || 8) <= 4 ||
  /Windows NT 6\.1/.test(nav.userAgent)
if (lowSpec) document.documentElement.dataset['perf'] = 'low'

installTodoAPI()
createApp(App).mount('#app')
window.__booted = true
installTestApi()
