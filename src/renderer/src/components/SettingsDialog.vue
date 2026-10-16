<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { CH } from '@shared/api'
import { setTheme, settingsState, updateSettings, type Theme } from '../store/settings'
import { ui } from '../store/ui'
import { useDialogFocus } from '../lib/dialog-focus'

const version = ref('')
const rootEl = ref<HTMLElement | null>(null)
const theme = computed(() => settingsState.value.theme)
const notifyEnabled = computed(() => settingsState.value.notifyEnabled)
const notifyAt = computed(() => settingsState.value.notifyAt)

function closeSettings(): void {
  ui.settingsOpen = false
}

/** 初次聚焦当前选中的主题按钮:一进来就能用方向键/回车换主题 */
function focusTheme(): HTMLElement | null {
  return rootEl.value?.querySelector<HTMLElement>(`[data-theme-opt="${theme.value}"]`) ?? null
}

const { isTopmost } = useDialogFocus(rootEl, closeSettings, focusTheme)

const THEMES: { value: Theme; label: string }[] = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' }
]

onMounted(async () => {
  const res = (await window.todoAPI.invoke(CH.appVersion)) as { ok: boolean; version?: string }
  version.value = res.ok ? (res.version ?? '') : ''
})

function onTheme(value: Theme): void {
  void setTheme(value)
}

function onNotifyToggle(event: Event): void {
  void updateSettings({ notifyEnabled: (event.target as HTMLInputElement).checked })
}

function onNotifyAt(event: Event): void {
  void updateSettings({ notifyAt: (event.target as HTMLInputElement).value })
}

function openDataDir(): void {
  void window.todoAPI.invoke(CH.storeOpenDir)
}
</script>

<template>
  <Teleport to="body">
    <div class="overlay" data-testid="settings-dialog" :inert="isTopmost ? undefined : true" @click.self="ui.settingsOpen = false">
      <div
        ref="rootEl"
        class="dialog"
        role="dialog"
        aria-labelledby="settings-dialog-title"
        :aria-modal="isTopmost ? 'true' : undefined"
      >
        <h2 id="settings-dialog-title">设置</h2>

        <section class="block">
          <div class="lbl">主题</div>
          <div class="seg">
            <button
              v-for="t in THEMES"
              :key="t.value"
              class="seg-btn"
              :class="{ active: theme === t.value }"
              :data-theme-opt="t.value"
              @click="onTheme(t.value)"
            >
              {{ t.label }}
            </button>
          </div>
        </section>

        <section class="block">
          <div class="lbl">到期提醒</div>
          <label class="inline">
            <input type="checkbox" data-testid="notify-toggle" :checked="notifyEnabled" @change="onNotifyToggle" />
            <span>每天到点提醒未完成任务</span>
          </label>
          <label class="inline">
            <span class="dim">提醒时间</span>
            <input type="time" data-testid="notify-at" :value="notifyAt" :disabled="!notifyEnabled" @change="onNotifyAt" />
          </label>
        </section>

        <section class="block">
          <div class="lbl">数据</div>
          <button class="btn" @click="openDataDir">打开数据目录</button>
        </section>

        <div class="foot">
          <span class="dim">迷你待办 {{ version }}</span>
          <span class="spacer" />
          <button class="btn" data-testid="settings-close" @click="ui.settingsOpen = false">关闭</button>
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
  margin: 0 0 16px;
  font-size: 18px;
  font-weight: 600;
}

.block {
  margin-bottom: 16px;
}

.lbl {
  margin-bottom: 6px;
  color: var(--text-dim);
  font-size: 12px;
}

.seg {
  display: flex;
  gap: 0;
  border: 1px solid var(--field-line);
  border-radius: var(--radius-control);
  overflow: hidden;
}

.seg-btn {
  flex: 1 1 0;
  min-height: 36px;
  color: var(--text);
}

.seg-btn + .seg-btn {
  border-left: 1px solid var(--field-line);
}

.seg-btn.active {
  background: var(--accent);
  color: var(--on-accent);
}

.inline {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.dim {
  color: var(--text-dim);
}

.foot {
  display: flex;
  align-items: center;
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
</style>
