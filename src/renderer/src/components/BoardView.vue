<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { today } from '@shared/dates'
import { columnsForView, filterActive } from '@shared/query'
import { cardBucket, moveCard } from '@shared/store-ops'
import type { Store } from '@shared/types'
import { importFromDialog, mutate, state } from '../store/data'
import { index } from '../store/index'
import { clearTaskConditions, hasTaskConditions, ui, requestNew } from '../store/ui'
import { newTaskPreset } from '../lib/keymap'
import BoardColumn from './BoardColumn.vue'
import Icon from './Icon.vue'

const COL_W = 300

/** 看板列受当前视图与两维筛选过滤(切「今天/明天/最近7天」列数跟着变) */
const columns = computed(() => columnsForView(index.value, ui.view, ui.taskFilter))
/** 每列竖向滚动位置,按日期留存(重排/切视图后不丢) */
const scrollByDate = reactive<Record<string, number>>({})
const dragId = ref('')
const dragPrio = ref(0)
const horizontal = ref<HTMLElement | null>(null)
const hScrollLeft = ref(0)
const hViewportW = ref(1200)
let ro: ResizeObserver | null = null

/** 只渲染与可视区相交的列(±1 列缓冲),列数很多时收益明显 */
const visibleColumns = computed(() => {
  const all = columns.value
  if (all.length === 0) return { start: 0, items: [] as typeof all }
  const start = Math.max(0, Math.floor(hScrollLeft.value / COL_W) - 1)
  const end = Math.min(all.length, Math.ceil((hScrollLeft.value + hViewportW.value) / COL_W) + 1)
  return { start, items: all.slice(start, end) }
})

const padLeft = computed(() => visibleColumns.value.start * COL_W)
const padRight = computed(() => {
  const { start, items } = visibleColumns.value
  return Math.max(0, (columns.value.length - start - items.length) * COL_W)
})

onMounted(() => {
  const host = horizontal.value
  if (!host) return
  hViewportW.value = host.clientWidth
  ro = new ResizeObserver(() => {
    hViewportW.value = host.clientWidth
  })
  ro.observe(host)
})

onBeforeUnmount(() => ro?.disconnect())

function onScroll(date: string, top: number): void {
  scrollByDate[date] = top
}

/** 空结果分两种:真没数据(给新建/导入)与「当前条件筛空了」(给清除条件)——不能混为一谈 */
const emptyText = computed(() => {
  const search = ui.search.trim()
  if (search !== '' && filterActive(ui.taskFilter)) return `没有匹配「${search}」的任务，当前筛选下也没有`
  if (search !== '') return `没有匹配「${search}」的任务`
  if (filterActive(ui.taskFilter)) return '当前筛选下没有排期任务'
  return '此视图暂无排期任务'
})

/**
 * 落点插入位由列组件给出「插到哪张可见卡之前」的 id,而不是可见下标 ——
 * 筛选下可见序列只是完整桶的一个子集,可见下标直接喂给 moveCard 会把顺序改错。
 * 这里在 mutate 里按拖动项自身的 status/prio 与落点日期重建**完整**目标桶(排除自身),
 * 把 beforeId 映射成完整桶下标;锚点没给(末尾/空桶)或已被删掉就追加桶尾。
 */
function targetIndex(store: Store, id: string, date: string, beforeId: string | null): number {
  // 完整桶由 store-ops 提供:判据与 moveCard 写回时同一份,不给未来留分叉
  const bucket = cardBucket(store, id, date)
  if (beforeId === null) return bucket.length
  const at = bucket.findIndex((t) => t.id === beforeId)
  return at < 0 ? bucket.length : at
}

function onDrop(date: string, beforeId: string | null): void {
  const id = dragId.value
  dragId.value = ''
  dragPrio.value = 0
  if (!id) return
  void mutate((s) => {
    if (!s.todos.some((t) => t.id === id)) return s
    return moveCard(s, id, date, targetIndex(s, id, date, beforeId))
  })
}

function onAdd(date: string): void {
  // 列日期覆盖预设日期,当前清单仍保留(看板列新建落在这一列,但不丢所在清单)
  requestNew({ ...newTaskPreset(), date })
}

/** 记录被拖动的卡片 id 与优先级(dragstart 冒泡到看板根节点) */
function onDragStart(event: DragEvent): void {
  const card = (event.target as HTMLElement).closest('[data-card]') as HTMLElement | null
  if (!card) return
  dragId.value = card.dataset['card'] ?? ''
  dragPrio.value = Number(card.dataset['prio'] ?? 0)
  event.dataTransfer?.setData('text/plain', dragId.value)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

function onDragEnd(): void {
  dragId.value = ''
  dragPrio.value = 0
}

/** 横向滚动:同步 scrollLeft 供列懒渲染;Ctrl+滚轮 时把竖向滚轮转成横向 */
function onScrollH(): void {
  const host = horizontal.value
  if (host) hScrollLeft.value = host.scrollLeft
}

function onWheel(event: WheelEvent): void {
  const host = horizontal.value
  if (!host || !event.ctrlKey) return
  event.preventDefault()
  host.scrollLeft += event.deltaY
  hScrollLeft.value = host.scrollLeft
}

/**
 * 回到今天:列宽固定 300px 且首列紧贴 0,所以目标列下标 × COL_W 即目标 scrollLeft。
 * 今天不在列里(无排期任务)时退到「今天之后的最近一列」,都没有则滚到末尾。
 */
function scrollToToday(): void {
  const host = horizontal.value
  if (!host) return
  const t0 = today()
  let idx = columns.value.findIndex((c) => c.date === t0)
  if (idx < 0) idx = columns.value.findIndex((c) => c.date > t0)
  if (idx < 0) idx = columns.value.length - 1
  host.scrollLeft = Math.max(0, idx * COL_W)
  hScrollLeft.value = host.scrollLeft
}

/** 方向键左右滚动一列(请求来自 keymap;列宽与容器只有这里知道) */
watch(
  () => ui.boardScroll.seq,
  () => {
    const host = horizontal.value
    if (!host) return
    host.scrollLeft = Math.max(0, host.scrollLeft + ui.boardScroll.delta * COL_W)
    hScrollLeft.value = host.scrollLeft
  }
)
</script>

<template>
  <div class="board" data-testid="board" @dragstart="onDragStart" @dragend="onDragEnd" @wheel="onWheel">
    <div v-if="columns.length > 0" class="bar">
      <span class="bar-title">看板</span>
      <span class="spacer" />
      <button class="today" data-testid="board-today" title="滚动到今天" @click="scrollToToday">
        <Icon name="today" :size="13" />今天
      </button>
    </div>

    <div v-if="columns.length === 0" class="empty">
      <p>{{ emptyText }}</p>
      <div class="empty-actions">
        <template v-if="hasTaskConditions()">
          <button class="btn" data-testid="clear-task-conditions" @click="clearTaskConditions()">清除搜索和筛选</button>
        </template>
        <template v-else>
          <button class="btn" data-testid="empty-new" @click="requestNew(newTaskPreset())">新建任务</button>
          <button class="btn" data-testid="empty-import" @click="void importFromDialog()">导入旧版数据</button>
          <button class="btn" data-testid="empty-help" @click="ui.helpOpen = true">查看快捷键</button>
        </template>
      </div>
    </div>

    <!-- 列容器常驻(空时只是隐藏):ResizeObserver 一旦挂上就不因空结果被摘掉,
         从「筛到 0」恢复到有结果时宽度立刻是对的 -->
    <div
      v-show="columns.length > 0"
      ref="horizontal"
      class="columns"
      data-testid="board-columns"
      @scroll="onScrollH"
    >
      <div :style="{ flex: `0 0 ${padLeft}px` }" />
      <BoardColumn
        v-for="col in visibleColumns.items"
        :key="col.date"
        :column="col"
        :scroll-top="scrollByDate[col.date] ?? 0"
        :drag-prio="dragPrio"
        :drag-id="dragId"
        @scroll="onScroll"
        @drop="onDrop"
        @add="onAdd"
      />
      <div :style="{ flex: `0 0 ${padRight}px` }" />
    </div>
  </div>
</template>

<style scoped>
.board {
  height: 100%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* 看板工具行:标题 + 「今天」快捷滚动,与列头等高(44px),不遮挡内容 */
.bar {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 44px;
  padding: 0 12px;
  flex: 0 0 auto;
  background: var(--panel);
  border-bottom: 1px solid var(--line);
}

.bar-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-dim);
}

.today {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0 12px;
  min-height: 28px;
  border-radius: var(--radius-control);
  border: 1px solid var(--field-line);
  background: var(--card);
  color: var(--text);
  font-size: 12px;
}

.today:hover {
  background: var(--hover);
  color: var(--accent);
  border-color: var(--accent);
}

.columns {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
  overflow-x: auto;
  overflow-y: hidden;
}

.empty {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--text-mute);
}

.empty-actions {
  display: flex;
  gap: 8px;
}

.btn {
  min-height: 36px;
  padding: 0 16px;
  border-radius: var(--radius-control);
  border: 1px solid var(--field-line);
  background: var(--card);
  color: var(--text);
}

.btn:hover {
  background: var(--hover);
}

.spacer {
  flex: 1 1 auto;
}
</style>
