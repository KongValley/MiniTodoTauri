<script setup lang="ts">
import { hideToast, ui } from '../store/ui'

defineProps<{ text: string; action?: { label: string; run: () => void } }>()

/** 动作按钮:执行回调后立刻收起(toast 的 4 秒超时不延长) */
function onAction(): void {
  const run = ui.toast?.action?.run
  hideToast()
  run?.()
}
</script>

<template>
  <div class="toast" data-testid="toast" role="status" aria-live="polite" aria-atomic="true">
    <span class="text">{{ text }}</span>
    <button v-if="action" class="act" data-testid="toast-action" @click="onAction">{{ action.label }}</button>
  </div>
</template>

<style scoped>
.toast {
  position: fixed;
  left: 50%;
  bottom: 54px;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 18px;
  border-radius: var(--radius-card);
  background: var(--text);
  color: var(--bg);
  font-size: 12px;
  box-shadow: var(--shadow-popover);
  z-index: 200;
  max-width: 70vw;
}

.text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.act {
  flex: 0 0 auto;
  padding: 2px 8px;
  border-radius: 5px;
  border: 1px solid currentcolor;
  background: transparent;
  color: var(--accent);
  font-size: 12px;
}

.act:hover {
  background: rgb(255 255 255 / 12%);
}
</style>
