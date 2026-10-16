<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { viewTitle } from '@shared/query'
import { state } from '../store/data'
import { requestNew, ui } from '../store/ui'
import { newTaskPreset, toggleBoard } from '../lib/keymap'
import { isComposingEvent } from '../lib/input-events'
import Icon from './Icon.vue'

const searchInput = ref<HTMLInputElement | null>(null)

watch(
  () => ui.searchOpen,
  (open) => {
    if (open) void nextTick(() => searchInput.value?.focus())
  }
)

function closeSearch(): void {
  ui.searchOpen = false
  ui.search = ''
}

/** 清空搜索词后焦点留在搜索框:按钮自己会因条件消失(v-if),焦点不能跟着掉到 body */
function clearSearch(): void {
  ui.search = ''
  void nextTick(() => searchInput.value?.focus())
}

/** 搜索框里的 Esc:选词中不处理,处理时也不让同一次事件落到全局 Esc(会顺手再关一层) */
function onSearchEsc(e: KeyboardEvent): void {
  if (isComposingEvent(e)) return
  e.stopPropagation()
  closeSearch()
}

function onNew(): void {
  // 走 requestNew:newTaskPreset 给的是 { date, list },对话框读的是 presetDate/presetList,
  // 直接展开 ui.dialog 会让预设静默失效
  requestNew(newTaskPreset())
}
</script>

<template>
  <header class="topbar" data-testid="topbar">
    <h1 class="title">{{ viewTitle(state.store, ui.view) }}</h1>

    <div class="search" :class="{ open: ui.searchOpen }">
      <input
        v-if="ui.searchOpen"
        ref="searchInput"
        v-model="ui.search"
        class="search-input"
        data-testid="search-input"
        placeholder="搜索任务…"
        aria-label="搜索任务"
        @keydown.esc="onSearchEsc"
      />
      <button
        v-if="ui.searchOpen && ui.search !== ''"
        class="icon-btn"
        data-testid="search-clear"
        title="清除搜索词"
        aria-label="清除搜索词"
        @click="clearSearch"
      >
        <Icon name="close" :size="13" />
      </button>
      <button class="icon-btn" data-testid="search-toggle" title="搜索 (Ctrl+F)" aria-label="搜索" @click="ui.searchOpen ? closeSearch() : (ui.searchOpen = true)">
        <Icon name="search" />
      </button>
    </div>

    <div class="actions">
      <button class="btn primary" data-testid="new-task" @click="onNew"><Icon name="newTask" :size="14" />新建</button>
      <button
        class="btn"
        data-testid="toggle-board"
        :title="ui.board ? '切换到列表 (B)' : '切换到看板 (B)'"
        @click="toggleBoard"
      >
        <Icon :name="ui.board ? 'listView' : 'boardView'" :size="14" />{{ ui.board ? '列表' : '看板' }}
      </button>
      <button class="btn" data-testid="open-settings" title="设置" aria-label="设置" @click="ui.settingsOpen = true">
        <Icon name="settings" :size="14" /><span class="btxt">设置</span>
      </button>
      <button class="btn" data-testid="open-help" title="快捷键" aria-label="快捷键" @click="ui.helpOpen = true">
        <Icon name="help" :size="14" /><span class="btxt">快捷键</span>
      </button>
    </div>
  </header>
</template>

<style scoped>
.topbar {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 64px;
  padding: 0 20px;
  border-bottom: 1px solid var(--line);
  background: var(--bg);
}

/* 视图名为主角:能缩,但不换行不撑破 */
.title {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.search {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  min-width: 0;
}

.search-input {
  width: clamp(140px, 22vw, 240px);
  min-width: 0;
}

.icon-btn {
  width: 32px;
  height: 32px;
  flex: 0 0 32px;
  border-radius: var(--radius-control);
  color: var(--text-dim);
  font-size: 15px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.icon-btn:hover {
  background: var(--hover);
  color: var(--text);
}

.actions {
  display: flex;
  gap: 8px;
  flex: 0 0 auto;
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 36px;
  padding: 0 14px;
  border-radius: var(--radius-control);
  border: 1px solid var(--field-line);
  background: var(--card);
  color: var(--text);
  white-space: nowrap;
}

.btn:hover {
  background: var(--hover);
}

.btn.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--on-accent);
}

.btn.primary:hover {
  background: var(--accent);
  box-shadow: var(--shadow-card);
}

/* 窄窗口(最小 900px)下设置/快捷键只留图标,操作区不折断 */
@media (max-width: 1100px) {
  .btxt {
    display: none;
  }

  .btn {
    padding: 0 10px;
  }
}
</style>
