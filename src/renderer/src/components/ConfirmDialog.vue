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
        style="--dialog-width: 440px"
      >
        <h2 id="confirm-dialog-title">{{ ui.confirm?.title }}</h2>
        <div class="dialog-body" tabindex="0" role="region" aria-label="确认说明">
          <p>{{ ui.confirm?.detail }}</p>
        </div>
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
  z-index: 110;
}

h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

p {
  margin: 0;
  color: var(--text-dim);
  white-space: pre-line;
}
</style>

