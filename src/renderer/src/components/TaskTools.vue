<script setup lang="ts">
/**
 * 常驻工具区(在滚动视图区之外,不参与列表/看板的虚拟滚动序列)。
 * 第一行:就地快捷录入 —— 只填标题,日期与清单沿用 newTaskPreset() 的统一预设。
 * 第二行:两维筛选(优先级 / 重复性),与看板列、列表行、导出同一口径(见 @shared/query 的 TaskFilter)。
 * 草稿只活在本组件里:看板/列表切换、点侧栏都不重挂它,草稿不丢。
 */
import { computed, ref } from 'vue'
import { label } from '@shared/dates'
import { filterActive, hitsFor, type TaskFilter } from '@shared/query'
import { addTodo, newId } from '@shared/store-ops'
import { INBOX_NAME, PRIO_NAME, type Prio } from '@shared/types'
import { mutate } from '../store/data'
import { clockTick, index } from '../store/index'
import { newTaskPreset } from '../lib/keymap'
import { isComposingEvent } from '../lib/input-events'
import { requestEdit, requestNew, resetTaskFilter, toast, ui } from '../store/ui'
import Icon from './Icon.vue'

const draft = ref('')
const titleInput = ref<HTMLInputElement | null>(null)

/** 待办视图之外(已完成/已放弃/回收站)没有「新建待办」的语义,整块隐藏 */
const show = computed(() => ui.view !== 'done' && ui.view !== 'dropped' && ui.view !== 'trash')

const preset = computed(() => {
  void clockTick.value // 跨零点后预设日期要跟着变(与侧栏计数同一份心跳)
  return newTaskPreset()
})

const presetHint = computed(() => {
  const p = preset.value
  const dateText = p.date === '' ? '未排期' : label(p.date)
  const listName = p.list === '' ? INBOX_NAME : (index.value.listOf.get(p.list)?.name ?? INBOX_NAME)
  return `${dateText} · ${listName}`
})

const canAdd = computed(() => draft.value.trim() !== '')

/* ---------- 第二行:两维筛选 ---------- */

interface PrioOption {
  value: 0 | Prio
  label: string
}

const PRIO_OPTIONS: PrioOption[] = [
  { value: 0, label: '全部' },
  { value: 1, label: PRIO_NAME[1] },
  { value: 2, label: PRIO_NAME[2] },
  { value: 3, label: PRIO_NAME[3] }
]

const REPEAT_OPTIONS: { value: TaskFilter['repeat']; label: string }[] = [
  { value: 'all', label: '全部类型' },
  { value: 'none', label: '一次性' },
  { value: 'recurring', label: '重复任务' }
]

const filterOn = computed(() => filterActive(ui.taskFilter))

/**
 * 看板模式下「筛到了但在这里根本没位置」的未排期项。
 * 未排期任务没有列可放,计数只算当前筛选命中里的那些 —— 用户点一下就能在列表里看到它们。
 */
const hiddenUnscheduled = computed(() => {
  if (!ui.board) return 0
  return hitsFor(index.value, ui.view, ui.taskFilter).filter((t) => t.date === '').length
})

/** 看板只显示有日期的任务,计数口径与之一致(列表计全部) */
function countOf(filter: TaskFilter): number {
  const items = hitsFor(index.value, ui.view, filter)
  return ui.board ? items.filter((t) => t.date !== '').length : items.length
}

const shownCount = computed(() => countOf(ui.taskFilter))
const baseCount = computed(() => countOf({ prio: 0, repeat: 'all' }))

function setPrioFilter(value: 0 | Prio): void {
  // 整体替换对象(readonly 字段不做原地赋值),与其余状态同一风格
  ui.taskFilter = { ...ui.taskFilter, prio: value }
}

function setRepeatFilter(event: Event): void {
  ui.taskFilter = { ...ui.taskFilter, repeat: (event.target as HTMLSelectElement).value as TaskFilter['repeat'] }
}

/** 新条目在当前搜索 + 视图 + 筛选下是否真的看得见;看板还要额外有日期才会出现 */
function visibleNow(id: string): boolean {
  const ix = index.value
  // index.hits 已按搜索词过滤,里面没有 = 被搜索排除
  const hit = ix.hits.find((t) => t.id === id)
  if (!hit) return false
  if (ui.board && hit.date === '') return false
  return hitsFor(ix, ui.view, ui.taskFilter).some((t) => t.id === id)
}

function add(): void {
  if (!canAdd.value) return
  const p = preset.value
  const id = newId()
  // 新条目继承筛出的优先级,免得刚建完就从眼前消失;重复性仍不推断(新建一律「不重复」)
  const prio = ui.taskFilter.prio === 0 ? 2 : ui.taskFilter.prio
  void mutate((s) => addTodo(s, { id, title: draft.value.trim(), date: p.date, lid: p.list, prio })).then(() => {
    draft.value = ''
    titleInput.value?.focus()
    // 内存已更新;写盘与否由状态栏的保存失败标记负责,这里不宣称「已保存」
    if (visibleNow(id)) toast('已添加')
    else toast('已添加，当前条件下不可见', { label: '查看', run: () => requestEdit(id) })
  })
}

/** 选词确认的 Enter 拿到的还是半成品,不能当提交 */
function onEnter(e: KeyboardEvent): void {
  if (isComposingEvent(e)) return
  e.preventDefault()
  add()
}

/** 本地 Esc:只清草稿/失焦,stopPropagation 免得上层把搜索词一起清了 */
function onEsc(e: KeyboardEvent): void {
  if (isComposingEvent(e)) return
  e.stopPropagation()
  if (draft.value !== '') draft.value = ''
  else titleInput.value?.blur()
}

/** 草稿转交完整弹窗填备注/日期;取消弹窗即放弃这份草稿(工具区已清空) */
function toDetails(): void {
  requestNew({ ...preset.value, title: draft.value.trim() })
  draft.value = ''
}
</script>

<template>
  <section v-if="show" class="tools" data-testid="task-tools">
    <div class="quick">
      <label class="vh" for="quick-title">快速添加任务</label>
      <input
        id="quick-title"
        ref="titleInput"
        v-model="draft"
        class="quick-input"
        data-testid="quick-title"
        placeholder="快速添加任务，Enter 保存"
        @keydown.enter="onEnter"
        @keydown.esc="onEsc"
      />
      <button class="btn primary" data-testid="quick-add" :disabled="!canAdd" @click="add">
        <Icon name="plus" :size="13" />添加
      </button>
      <button
        class="btn"
        data-testid="quick-details"
        title="在完整弹窗里继续填备注 / 日期 / 重复"
        @click="toDetails"
      >
        <Icon name="edit" :size="13" />详细编辑
      </button>
      <span class="hint" data-testid="quick-preset">{{ presetHint }}</span>
    </div>

    <div class="filters">
      <span class="flabel">优先级</span>
      <div class="seg" role="group" aria-label="按优先级筛选">
        <button
          v-for="opt in PRIO_OPTIONS"
          :key="opt.value"
          class="seg-btn"
          :class="{ on: ui.taskFilter.prio === opt.value }"
          :data-filter-prio="opt.value"
          :aria-pressed="ui.taskFilter.prio === opt.value"
          :title="opt.value === 0 ? '不按优先级筛选' : `只看${opt.label}优先级`"
          @click="setPrioFilter(opt.value)"
        >
          {{ opt.label }}
        </button>
      </div>

      <label class="flabel" for="filter-repeat">重复性</label>
      <select
        id="filter-repeat"
        data-testid="filter-repeat"
        :value="ui.taskFilter.repeat"
        @change="setRepeatFilter"
      >
        <option v-for="opt in REPEAT_OPTIONS" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
      </select>

      <button v-if="filterOn" class="btn" data-testid="filter-clear" @click="resetTaskFilter()">
        <Icon name="close" :size="12" />清除筛选
      </button>

      <span class="spacer" />

      <span class="counts" data-testid="task-tools-count">显示 {{ shownCount }} / {{ baseCount }} 项</span>
      <button
        v-if="hiddenUnscheduled > 0"
        class="btn"
        data-testid="show-unscheduled"
        title="未排期任务只在列表里有位置"
        @click="ui.board = false"
      >
        未排期 {{ hiddenUnscheduled }} 项，切到列表
      </button>
    </div>
  </section>
</template>

<style scoped>
.tools {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 20px;
  border-bottom: 1px solid var(--line);
  background: var(--bg);
}

.quick {
  display: flex;
  align-items: center;
  gap: 8px;
  position: relative;
}

.quick-input {
  flex: 1 1 auto;
  min-width: 0;
  height: 40px;
}

.filters {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  min-height: 36px;
  font-size: 12px;
  color: var(--text-dim);
}

.flabel {
  flex: 0 0 auto;
}

.seg {
  display: flex;
  border: 1px solid var(--field-line);
  border-radius: var(--radius-control);
  overflow: hidden;
}

.seg-btn {
  min-height: 28px;
  padding: 0 12px;
  color: var(--text);
  background: var(--card);
}

.seg-btn + .seg-btn {
  border-left: 1px solid var(--field-line);
}

.seg-btn:hover {
  background: var(--hover);
}

.seg-btn.on {
  background: var(--accent);
  color: var(--on-accent);
}

.counts {
  font-variant-numeric: tabular-nums;
}

.spacer {
  flex: 1 1 auto;
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 36px;
  padding: 0 14px;
  border-radius: var(--radius-control);
  border: 1px solid var(--field-line);
  background: var(--card);
  color: var(--text);
  white-space: nowrap;
}

.btn:hover:not(:disabled) {
  background: var(--hover);
}

.btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.btn.primary {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--on-accent);
}

.btn.primary:hover:not(:disabled) {
  background: var(--accent);
  box-shadow: var(--shadow-card);
}

.hint {
  color: var(--text-dim);
  font-size: 12px;
  white-space: nowrap;
}

/* 视觉隐藏但保留给读屏的 label */
.vh {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>
