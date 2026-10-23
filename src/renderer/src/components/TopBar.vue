<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { viewTitle } from '@shared/query'
import { state } from '../store/data'
import { requestNew, ui } from '../store/ui'
import { newTaskPreset, toggleBoard } from '../lib/keymap'
import { isComposingEvent } from '../lib/input-events'
import Icon from './Icon.vue'

const searchInput = ref<HTMLInputElement | null>(null)

/** 搜索框常驻:清空后焦点必须留在输入上,否则按钮随条件消失、焦点掉到 body */
function clearSearch(): void {
  ui.search = ''
  void nextTick(() => searchInput.value?.focus())
}

/** Esc:非 IME 选词时清空查询并失焦;stopPropagation 免得上层把别的层级也关掉 */
function onSearchEsc(e: KeyboardEvent): void {
  if (isComposingEvent(e)) return
  e.stopPropagation()
  ui.search = ''
  searchInput.value?.blur()
}

function onNew(): void {
  // 走 requestNew:newTaskPreset 给的是 { date, list },对话框读的是 presetDate/presetList,
  // 直接展开 ui.dialog 会让预设静默失效
  requestNew(newTaskPreset())
}

/**
 * 显式二选一的视图切换:点当前视图什么都不做。
 * 直接调 toggleBoard() 会卸载/重挂 BoardView 与 ListView —— 选择被清空、草稿重来。
 */
function pickBoard(on: boolean): void {
  if (ui.board !== on) toggleBoard()
}
</script>

<template>
  <header class="topbar" data-testid="topbar">
    <h1 class="title">{{ viewTitle(state.store, ui.view) }}</h1>

    <div class="search">
      <span class="search-ico"><Icon name="search" :size="14" /></span>
      <input
        ref="searchInput"
        v-model="ui.search"
        class="search-input"
        data-testid="search-input"
        placeholder="搜索任务"
        aria-label="搜索任务"
        @keydown.esc="onSearchEsc"
      />
      <button
        v-if="ui.search !== ''"
        class="icon-btn"
        data-testid="search-clear"
        title="清除搜索词"
        aria-label="清除搜索词"
        @click="clearSearch"
      >
        <Icon name="close" :size="13" />
      </button>
    </div>

    <div class="views" role="group" aria-label="任务视图">
      <button
        class="btn view-btn"
        data-testid="view-board"
        :aria-pressed="ui.board"
        :title="ui.board ? '当前是看板' : '切到看板 (B)'"
        @click="pickBoard(true)"
      >
        <Icon name="boardView" :size="14" />看板
      </button>
      <button
        class="btn view-btn"
        data-testid="view-list"
        :aria-pressed="!ui.board"
        :title="ui.board ? '切到列表 (B)' : '当前是列表'"
        @click="pickBoard(false)"
      >
        <Icon name="listView" :size="14" />列表
      </button>
    </div>

    <button class="btn primary new-task" data-testid="new-task" @click="onNew">
      <Icon name="newTask" :size="14" />新建
    </button>
  </header>
</template>

<style scoped>
.topbar {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 56px;
  padding: 0 16px;
  border-bottom: 1px solid var(--line);
  background: var(--bg);
}

/* 视图名为主角:能缩,但不换行不撑破 */
.title {
  margin: 0;
  flex: 1 1 auto;
  min-width: 0;
  font-size: 20px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.search {
  position: relative;
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
}

.search-ico {
  position: absolute;
  left: 8px;
  display: inline-flex;
  color: var(--text-mute);
  pointer-events: none;
}

.search-input {
  width: 260px;
  height: 32px;
  padding-left: 28px;
}

.search .icon-btn {
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
}

.views {
  display: flex;
  gap: 0;
  flex: 0 0 auto;
}

.views .view-btn {
  border-radius: 0;
  color: var(--text-dim);
}

.views .view-btn:first-child {
  border-radius: var(--radius-control) 0 0 var(--radius-control);
}

.views .view-btn:last-child {
  border-radius: 0 var(--radius-control) var(--radius-control) 0;
  margin-left: -1px;
}

/* 当前视图:实心 accent,一眼看出在看哪个 */
.views .view-btn[aria-pressed='true'] {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--on-accent);
  position: relative;
  z-index: 1;
}

.new-task {
  flex: 0 0 auto;
}

/* 窄窗口:搜索收窄,标题先让位,操作区不折断 */
@media (max-width: 1100px) {
  .search-input {
    width: 176px;
  }

  .title {
    flex: 0 1 auto;
    font-size: 18px;
  }
}
</style>
