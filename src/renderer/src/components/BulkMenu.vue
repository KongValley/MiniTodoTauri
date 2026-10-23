<script setup lang="ts">
/**
 * 列表视图的批量操作菜单（选中 N 条后出现）。
 * 全部动作都复用 store-ops 的纯函数，逐条 reduce 应用 —— 与单条右键菜单同一套语义，
 * 不另写一套批量实现（重复任务的「完成即生成下一期」也因此自动生效）。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { addDays, today } from '@shared/dates'
import { completeTodo, moveCard, updateTodo } from '@shared/store-ops'
import { INBOX_NAME, PRIO_NAME, type Prio, type Store } from '@shared/types'
import { mutate, state } from '../store/data'
import { toast } from '../store/ui'
import { clearSelection } from '../lib/selection'
import { isComposingEvent } from '../lib/input-events'
import Icon from './Icon.vue'

const props = defineProps<{ ids: string[] }>()
const emit = defineEmits<{ close: [] }>()

/** 与 CardMenu 同款：索引给桶尾，moveCard 内部把越界钳到 [0, n] */
const TAIL = Number.MAX_SAFE_INTEGER

const lists = computed(() => state.store.lists)
const lid = ref('')
const menuEl = ref<HTMLElement | null>(null)
/** 打开浮层前谁拿着焦点:Esc 收起时还给它 */
let trigger: HTMLElement | null = null

function apply(op: (s: Store, id: string) => Store, label: string): void {
  const ids = [...props.ids]
  if (ids.length === 0) return
  void mutate((s) => ids.reduce((acc, id) => op(acc, id), s)).then(() => toast(`${label}（${ids.length} 条）`))
  clearSelection()
  emit('close')
}

function setPrio(prio: Prio): void {
  apply((s, id) => updateTodo(s, id, { prio }), `优先级：${PRIO_NAME[prio]}`)
}

function reschedule(date: string, label: string): void {
  apply((s, id) => moveCard(s, id, date, TAIL), `已改期：${label}`)
}

function moveToList(): void {
  const name = lists.value.find((l) => l.id === lid.value)?.name ?? INBOX_NAME
  apply((s, id) => updateTodo(s, id, { lid: lid.value }), `已移动到「${name}」`)
}

function onDocClick(): void {
  emit('close')
}

/** Esc 收起并把焦点还给「批量…」按钮(挂 window:焦点不在面板里也要能收) */
function onWindowKeyDown(e: KeyboardEvent): void {
  if (e.key !== 'Escape' || isComposingEvent(e)) return
  e.preventDefault()
  e.stopPropagation()
  const back = trigger
  emit('close')
  void nextTick(() => {
    if (back && back.isConnected && back !== document.body && !(back as HTMLButtonElement).disabled) back.focus()
  })
}

/** 焦点离开浮层:收起,但不把焦点拉回来 */
function onFocusOut(e: FocusEvent): void {
  const next = e.relatedTarget as Node | null
  if (next && menuEl.value?.contains(next)) return
  emit('close')
}

onMounted(() => {
  trigger = document.activeElement as HTMLElement | null
  document.addEventListener('click', onDocClick)
  window.addEventListener('keydown', onWindowKeyDown)
  // 打开即聚焦第一个可用操作
  void nextTick(() =>
    menuEl.value?.querySelector<HTMLElement>('button:not([disabled]), select:not([disabled])')?.focus()
  )
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
  window.removeEventListener('keydown', onWindowKeyDown)
})
</script>

<template>
  <div
    ref="menuEl"
    class="menu"
    data-testid="bulk-menu-panel"
    role="group"
    aria-label="批量任务操作"
    @click.stop
    @focusout="onFocusOut"
  >
    <button class="mi" data-bulk="complete" @click="apply((s, id) => completeTodo(s, id), '已标记完成')">
      <Icon name="check" :size="14" class="mi-ico" />
      <span>完成</span>
    </button>

    <div class="mi-row" role="group" aria-label="设置优先级">
      <button
        v-for="p in [1, 2, 3] as const"
        :key="p"
        class="mi mini"
        :class="`p${p}`"
        :data-bulk="PRIO_NAME[p]"
        :title="`设为${PRIO_NAME[p]}优先级`"
        :aria-label="`设为${PRIO_NAME[p]}优先级`"
        @click="setPrio(p)"
      >
        <Icon :name="p === 1 ? 'flagHigh' : p === 2 ? 'flagMid' : 'flagLow'" :size="13" />
        <span>{{ PRIO_NAME[p] }}</span>
      </button>
    </div>

    <button class="mi" data-bulk="today" @click="reschedule(today(), '今天')">
      <Icon name="today" :size="14" class="mi-ico" />
      <span>改期到今天</span>
    </button>
    <button class="mi" data-bulk="tmr" @click="reschedule(addDays(today(), 1), '明天')">
      <Icon name="tmr" :size="14" class="mi-ico" />
      <span>改期到明天</span>
    </button>
    <button class="mi" data-bulk="later" @click="reschedule(addDays(today(), 2), '后天')">
      <Icon name="calendar" :size="14" class="mi-ico" />
      <span>改期到后天</span>
    </button>
    <button class="mi" data-bulk="unscheduled" @click="reschedule('', '未排期')">
      <Icon name="inbox" :size="14" class="mi-ico" />
      <span>清除日期</span>
    </button>

    <div class="row-select">
      <span id="bulk-list-label" class="lbl">移动到</span>
      <select v-model="lid" data-testid="bulk-list" aria-labelledby="bulk-list-label" @change="moveToList">
        <option value="">{{ INBOX_NAME }}</option>
        <option v-for="l in lists" :key="l.id" :value="l.id">{{ l.name }}</option>
      </select>
    </div>
  </div>
</template>

<style scoped>
.menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 8px;
  z-index: 120;
  min-width: 224px;
  max-height: calc(100vh - 16px);
  overflow-y: auto;
  padding: 6px;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-popover);
  text-align: left;
}

.mi {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 32px;
  padding: 0 10px;
  border: 0;
  border-radius: var(--radius-control);
  background: transparent;
  color: var(--text);
  font-size: 13px;
  text-align: left;
}

.mi:hover {
  background: var(--hover);
}

.mi-ico {
  color: var(--text-dim);
}

.mini.p1 :deep(svg) {
  color: var(--prio-1);
}

.mini.p2 :deep(svg) {
  color: var(--prio-2);
}

.mini.p3 :deep(svg) {
  color: var(--prio-3);
}

.mi-row {
  display: flex;
  gap: 4px;
  padding: 2px 4px;
}

.mi.mini {
  justify-content: center;
  width: auto;
  flex: 1 1 0;
  gap: 4px;
  border: 1px solid var(--line);
  font-size: 12px;
  color: var(--text-dim);
}

.row-select {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px 2px;
  border-top: 1px solid var(--line);
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-dim);
}

.row-select .lbl {
  flex: 0 0 auto;
}

.row-select select {
  flex: 1 1 auto;
  min-width: 0;
  padding: 2px 4px;
  border: 1px solid var(--field-line);
  border-radius: 5px;
  background: var(--field);
  color: var(--text);
  font-size: 12px;
}
</style>
