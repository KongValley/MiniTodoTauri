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
  bottom: 48px;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 14px;
  max-width: min(560px, calc(100vw - 32px));
  border-radius: var(--radius-card);
  border: 1px solid var(--line);
  background: var(--card);
  color: var(--text);
  font-size: 12px;
  box-shadow: var(--shadow-popover);
  z-index: 200;
}

.text {
  min-width: 0;
  overflow-wrap: anywhere;
}

.act {
  flex: 0 0 auto;
  min-height: 28px;
  padding: 0 10px;
  border-radius: var(--radius-control);
  border: 1px solid var(--field-line);
  background: transparent;
  color: var(--accent);
  font-size: 12px;
}

.act:hover {
  background: var(--hover);
}
</style>
