<script setup lang="ts">
import { ref } from 'vue'
import { ui } from '../store/ui'
import { useDialogFocus } from '../lib/dialog-focus'

const rootEl = ref<HTMLElement | null>(null)

function cancel(): void {
  ui.confirm = null
}

/** 二次确认的默认动作是「别做」:初始焦点给取消,回车不会误删 */
function focusCancel(): HTMLElement | null {
  return rootEl.value?.querySelector<HTMLElement>('[data-testid="confirm-cancel"]') ?? null
}

const { isTopmost } = useDialogFocus(rootEl, cancel, focusCancel)

function ok(): void {
  const action = ui.confirm?.onOk
  ui.confirm = null
  action?.()
}

function onSecondary(): void {
  const action = ui.confirm?.secondary?.onOk
  ui.confirm = null
  action?.()
}
</script>

<template>
  <Teleport to="body">
    <div class="overlay" data-testid="confirm-dialog" :inert="isTopmost ? undefined : true" @click.self="cancel">
      <div
        ref="rootEl"
        class="dialog"
        role="dialog"
        aria-labelledby="confirm-dialog-title"
        :aria-modal="isTopmost ? 'true' : undefined"
      >
        <h2 id="confirm-dialog-title">{{ ui.confirm?.title }}</h2>
        <p>{{ ui.confirm?.detail }}</p>
        <div class="foot">
          <span class="spacer" />
          <button class="btn" data-testid="confirm-cancel" @click="cancel">取消</button>
          <button v-if="ui.confirm?.secondary" class="btn" data-testid="confirm-secondary" @click="onSecondary">
            {{ ui.confirm.secondary.label }}
          </button>
          <button class="btn danger" data-testid="confirm-ok" @click="ok">确定</button>
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
  z-index: 110;
}

.dialog {
  width: 420px;
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
  margin: 0 0 10px;
  font-size: 18px;
  font-weight: 600;
}

p {
  margin: 0 0 20px;
  color: var(--text-dim);
  line-height: 1.6;
  white-space: pre-line;
}

.foot {
  display: flex;
  gap: 8px;
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

.btn.danger {
  color: var(--danger);
  border-color: var(--danger);
}
</style>
