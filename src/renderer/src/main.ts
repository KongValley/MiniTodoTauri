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

installTodoAPI()
createApp(App).mount('#app')
window.__booted = true
installTestApi()
