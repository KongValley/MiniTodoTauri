<script setup lang="ts">
import { ref } from 'vue'
import { ui } from '../store/ui'
import { useDialogFocus } from '../lib/dialog-focus'

const rootEl = ref<HTMLElement | null>(null)

function closeHelp(): void {
  ui.helpOpen = false
}

/** 帮助弹窗没有输入项:初始焦点给「关闭」,ESC/回车都能直接收起 */
function focusClose(): HTMLElement | null {
  return rootEl.value?.querySelector<HTMLElement>('[data-testid="help-close"]') ?? null
}

const { isTopmost } = useDialogFocus(rootEl, closeHelp, focusClose)

const ROWS: [string, string][] = [
  ['N', '新建任务'],
  ['Enter / F2', '打开选中任务'],
  ['Del', '删除选中（回收站视图里是彻底删除）'],
  ['↑ ↓', '列表：移动选中行（Shift 连选）'],
  ['Home / End', '列表：跳到首 / 尾'],
  ['← →', '看板：左右滚动一列'],
  ['Ctrl+D', '复制选中任务'],
  ['Ctrl+V', '从剪贴板批量新建（多行文本；输入框内仍是原生粘贴）'],
  ['B', '切换看板 / 列表'],
  ['Ctrl+F', '搜索'],
  ['Esc', '关闭弹窗 / 清空搜索'],
  ['F5', '刷新'],
  ['1 2 3 4', '今天 / 明天 / 最近7天 / 所有'],
  ['看板内滚轮', '上下滚动鼠标所在列'],
  ['Ctrl + 滚轮', '看板内左右滚动日期列'],
  ['拖拽卡片', '改期 / 同优先级桶内排序']
]
</script>

<template>
  <Teleport to="body">
    <div class="overlay" data-testid="help-dialog" :inert="isTopmost ? undefined : true" @click.self="ui.helpOpen = false">
      <div
        ref="rootEl"
        class="dialog"
        role="dialog"
        aria-labelledby="help-dialog-title"
        :aria-modal="isTopmost ? 'true' : undefined"
      >
        <h2 id="help-dialog-title">快捷键</h2>
        <table>
          <tbody>
            <tr v-for="[key, desc] in ROWS" :key="key">
              <td class="k"><kbd>{{ key }}</kbd></td>
              <td class="d">{{ desc }}</td>
            </tr>
          </tbody>
        </table>
        <div class="foot">
          <span class="spacer" />
          <button class="btn" data-testid="help-close" @click="ui.helpOpen = false">关闭</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: var(--overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.dialog {
  width: 520px;
  max-width: calc(100vw - 48px);
  max-height: calc(100vh - 48px);
  overflow-y: auto;
  padding: 24px;
  border-radius: var(--radius-dialog);
  background: var(--card);
  border: 1px solid var(--line);
  box-shadow: var(--shadow-popover);
}

h2 {
  margin: 0 0 16px;
  font-size: 18px;
  font-weight: 600;
}

table {
  width: 100%;
  border-collapse: collapse;
}

td {
  padding: 5px 0;
  vertical-align: top;
}

.k {
  width: 110px;
}

kbd {
  display: inline-block;
  padding: 3px 8px;
  border-radius: var(--radius-control);
  border: 1px solid var(--field-line);
  background: var(--panel);
  font-family: inherit;
  font-size: 12px;
}

.d {
  color: var(--text-dim);
  line-height: 1.5;
}

.foot {
  display: flex;
  margin-top: 16px;
}

.spacer {
  flex: 1 1 auto;
}

.btn {
  min-height: 36px;
  padding: 0 16px;
  border-radius: var(--radius-control);
  border: 1px solid var(--field-line);
  background: var(--card);
}

.btn:hover {
  background: var(--hover);
}
</style>
