<script setup lang="ts">
/**
 * 列表视图的批量操作菜单（选中 N 条后出现）。
 * 全部动作都复用 store-ops 的纯函数，逐条 reduce 应用 —— 与单条右键菜单同一套语义，
 * 不另写一套批量实现（重复任务的「完成即生成下一期」也因此自动生效）。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { addDays, today } from '@shared/dates'
import { completeTodo, moveCard, updateTodo } from '@shared/store-ops'
import { INBOX_NAME, PRIO_COLOR, PRIO_NAME, type Prio, type Store } from '@shared/types'
import { mutate, state } from '../store/data'
import { toast } from '../store/ui'
import { clearSelection } from '../lib/selection'
import Icon from './Icon.vue'

const props = defineProps<{ ids: string[] }>()
const emit = defineEmits<{ close: [] }>()

/** 与 CardMenu 同款：索引给桶尾，moveCard 内部把越界钳到 [0, n] */
const TAIL = Number.MAX_SAFE_INTEGER

const lists = computed(() => state.store.lists)
const lid = ref('')

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

onMounted(() => document.addEventListener('click', onDocClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))
</script>

<template>
  <div class="menu" data-testid="bulk-menu-panel" role="menu" @click.stop>
    <button class="mi" data-bulk="complete" role="menuitem" @click="apply((s, id) => completeTodo(s, id), '已标记完成')">
      <Icon name="check" :size="14" class="mi-ico" />
      <span>完成</span>
    </button>

    <div class="mi-row">
      <button v-for="p in [1, 2, 3] as const" :key="p" class="mi mini" :data-bulk="PRIO_NAME[p]" role="menuitem" @click="setPrio(p)">
        <Icon :name="p === 1 ? 'flagHigh' : p === 2 ? 'flagMid' : 'flagLow'" :size="13" :style="{ color: PRIO_COLOR[p] }" />
      </button>
    </div>

    <button class="mi" data-bulk="today" role="menuitem" @click="reschedule(today(), '今天')">
      <Icon name="today" :size="14" class="mi-ico" />
      <span>改期到今天</span>
    </button>
    <button class="mi" data-bulk="tmr" role="menuitem" @click="reschedule(addDays(today(), 1), '明天')">
      <Icon name="tmr" :size="14" class="mi-ico" />
      <span>改期到明天</span>
    </button>
    <button class="mi" data-bulk="later" role="menuitem" @click="reschedule(addDays(today(), 2), '后天')">
      <Icon name="calendar" :size="14" class="mi-ico" />
      <span>改期到后天</span>
    </button>
    <button class="mi" data-bulk="unscheduled" role="menuitem" @click="reschedule('', '未排期')">
      <Icon name="inbox" :size="14" class="mi-ico" />
      <span>清除日期</span>
    </button>

    <div class="row-select">
      <span class="lbl">移动到</span>
      <select v-model="lid" data-testid="bulk-list" @change="moveToList">
        <option value="">{{ INBOX_NAME }}</option>
        <option v-for="l in lists" :key="l.id" :value="l.id">{{ l.name }}</option>
      </select>
    </div>
  </div>
</template>

<style scoped>
.menu {
  position: absolute;
  top: 32px;
  right: 8px;
  z-index: 120;
  min-width: 176px;
  padding: 4px;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 8px;
  box-shadow: 0 12px 40px rgb(0 0 0 / 25%);
  text-align: left;
}

.mi {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 5px 8px;
  border: 0;
  border-radius: 6px;
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

.mi-row {
  display: flex;
  gap: 4px;
  padding: 2px 4px;
}

.mi.mini {
  justify-content: center;
  width: auto;
  flex: 1 1 0;
  padding: 4px 0;
  border: 1px solid var(--line);
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
