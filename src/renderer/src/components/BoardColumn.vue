<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, onUpdated, ref, watch } from 'vue'
import { label } from '@shared/dates'
import { bucketsOf } from '@shared/query'
import type { BoardColumn as BoardColumnData } from '@shared/store-index'
import { INBOX_NAME, PRIO_NAME, type Prio, type TodoItem } from '@shared/types'
import TaskCard from './TaskCard.vue'
import Icon from './Icon.vue'
import { index } from '../store/index'
import { useVirtual } from '../lib/virtual'

const props = defineProps<{
  column: BoardColumnData
  scrollTop: number
  /** 正在拖动的卡片优先级(0 = 无拖动);插入位只在同优先级桶内计算 */
  dragPrio: number
  /** 正在拖动的卡片 id:插入位统计要排除自身,才与 moveCard 的桶一致 */
  dragId: string
}>()

const emit = defineEmits<{
  (e: 'scroll', date: string, top: number): void
  (e: 'drop', date: string, beforeId: string | null): void
  (e: 'add', date: string): void
}>()

const scroller = ref<HTMLElement | null>(null)
const dropActive = ref(false)

/** 桶只在列数据变化时重算,不再每次渲染跑一遍 */
const buckets = computed(() => bucketsOf(props.column.items))

const listName = (lid: string): string => index.value.listOf.get(lid)?.name ?? INBOX_NAME
const listColor = (lid: string): string => index.value.listOf.get(lid)?.color ?? '#9AA0A8'
/** 整列共享同一个日期,标签只算一次 */
const dateLabel = computed(() => label(props.column.date))

/* ---------- 卡片虚拟滚动 ---------- */
// 渲染序列:桶内卡片摊平(prio 高→低,桶内 order/seq),桶首项带上组标题
interface Row {
  item: TodoItem
  prio: Prio
  head: { prio: Prio; count: number } | null
}

const rows = computed<Row[]>(() => {
  const out: Row[] = []
  for (const b of buckets.value) {
    b.items.forEach((item, i) => {
      out.push({ item, prio: b.prio, head: i === 0 ? { prio: b.prio, count: b.items.length } : null })
    })
  }
  return out
})

/** 估算:卡片本体约 84px(两行标题 + meta + padding),带组标题再加 32px。
 *  初值只用于首帧占位,挂载后由 measureAll() 批量校正 */
const CARD_ESTIMATE = 84
const HEAD_ESTIMATE = 32
const estimateOf = (r: Row): number => CARD_ESTIMATE + (r.head ? HEAD_ESTIMATE : 0)

const localScrollTop = ref(props.scrollTop)
const viewportH = ref(400)
let ro: ResizeObserver | null = null
const virtual = useVirtual<Row>({
  items: () => rows.value,
  keyOf: (r) => r.item.id,
  scrollTop: localScrollTop,
  viewportH,
  estimateOf,
  overscan: 4
})

/**
 * 落点锚点:鼠标下半屏落在哪张已渲染卡片之前。
 * 只认同优先级、且不是被拖动的那张 —— moveCard 的桶语义就是「同日期同优先级」。
 * 虚拟滚动下未渲染的卡片没有 DOM,所以先定位命中行,再从那里往后找第一张符合的卡;
 * 找不到(落在最末/空列)返回 null,调用方按桶尾处理。
 */
function beforeIdFromEvent(event: DragEvent): string | null {
  const host = scroller.value
  if (!host || props.dragPrio === 0) return null

  // 必须查 vrow 包装层而不是 [data-card]:data-row 挂在 vrow 上,
  // 卡片自己没有 → 读不到时 hitRow 恒为末尾,向下拖会被算到桶尾而差一格
  const rendered = [...host.querySelectorAll<HTMLElement>('[data-vrow]')]
  let hitRow = rows.value.length
  for (const el of rendered) {
    const rect = el.getBoundingClientRect()
    if (event.clientY < rect.top + rect.height / 2) {
      hitRow = Number(el.dataset['row'] ?? rows.value.length)
      break
    }
  }

  for (let i = Math.max(0, hitRow); i < rows.value.length; i++) {
    const r = rows.value[i] as Row
    if (r.prio === props.dragPrio && r.item.id !== props.dragId) return r.item.id
  }
  return null
}

function onDragOver(event: DragEvent): void {
  event.preventDefault()
  dropActive.value = true
}

function onDragLeave(): void {
  dropActive.value = false
}

function onDrop(event: DragEvent): void {
  event.preventDefault()
  const beforeId = beforeIdFromEvent(event)
  dropActive.value = false
  emit('drop', props.column.date, beforeId)
}

function onScroll(): void {
  const host = scroller.value
  if (!host) return
  localScrollTop.value = host.scrollTop
  emit('scroll', props.column.date, host.scrollTop)
}

/**
 * 一次性测量所有已渲染行的高度。
 * 逐个元素读 offsetHeight 会强制 72 次同步重排(实测单列 340 ms);
 * 这里在一个循环里读完再写回,浏览器只做一次布局。
 */
function measureAll(): void {
  const host = scroller.value
  if (!host) return
  const nodes = host.querySelectorAll<HTMLElement>('[data-vrow]')
  const batch: { key: string; h: number }[] = []
  for (const el of nodes) {
    const key = el.dataset['vrow']
    if (key) batch.push({ key, h: el.offsetHeight })
  }
  for (const b of batch) virtual.measure(b.key, b.h)
}

onMounted(() => {
  const host = scroller.value
  if (!host) return
  viewportH.value = host.clientHeight
  if (props.scrollTop > 0) {
    host.scrollTop = props.scrollTop
    localScrollTop.value = props.scrollTop
  }
  measureAll()
  ro = new ResizeObserver(() => {
    viewportH.value = host.clientHeight
  })
  ro.observe(host)
})

// 不 disconnect 会让被销毁的列仍被观察,内存只增不减
onBeforeUnmount(() => ro?.disconnect())

/**
 * 每次重渲染后补测新出现的行(高度未知的行才需要,measure 内部会跳过未变化的)。
 * 一帧内只跑一次:一次变更会让 12 列依次 updated,逐列立即 measureAll 就是 12 次强制布局;
 * 合并到下一帧末尾,一次布局即可读到所有列的新高度。
 */
let measureScheduled = false
function scheduleMeasure(): void {
  if (measureScheduled) return
  measureScheduled = true
  requestAnimationFrame(() => {
    measureScheduled = false
    measureAll()
  })
}

onUpdated(scheduleMeasure)

watch(
  () => props.scrollTop,
  (top) => {
    const host = scroller.value
    if (host && Math.abs(host.scrollTop - top) > 1) {
      host.scrollTop = top
      localScrollTop.value = top
    }
  }
)
</script>

<template>
  <section class="column" :data-column="column.date" :class="{ dropping: dropActive }">
    <header class="head">
      <span class="date">{{ label(column.date) }}</span>
      <span class="count">{{ column.items.length }}</span>
      <button class="add" :data-add="column.date" title="在这一天新建任务" @click="emit('add', column.date)">
        <Icon name="plus" />
      </button>
    </header>

    <div
      ref="scroller"
      class="content thin-scroll"
      @scroll="onScroll"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
    >
      <div v-if="column.items.length === 0" class="empty-col">拖卡片到这里</div>

      <template v-else>
        <div :style="{ height: `${virtual.state.value.padTop}px` }" />
        <div
          v-for="v in virtual.state.value.visible"
          :key="v.item.item.id"
          class="vrow"
          :data-vrow="v.item.item.id"
          :data-row="v.index"
        >
          <div v-if="v.item.head" class="group-head" :data-prio-head="v.item.head.prio">
            <span>{{ PRIO_NAME[v.item.head.prio] }}优先级</span>
            <span class="gcount">{{ v.item.head.count }}</span>
          </div>
          <TaskCard
            :item="v.item.item"
            :list-name="listName(v.item.item.lid)"
            :list-color="listColor(v.item.item.lid)"
            :date-label="dateLabel"
          />
        </div>
        <div :style="{ height: `${virtual.state.value.padBottom}px` }" />
      </template>
    </div>
  </section>
</template>

<style scoped>
.column {
  flex: 0 0 300px;
  width: 300px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-right: 1px solid var(--line);
  background: var(--bg);
}

.column.dropping {
  background: var(--accent-soft);
}

.head {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 0 10px;
  border-bottom: 1px solid var(--line);
  background: var(--panel);
  flex: 0 0 auto;
}

.date {
  font-size: 13px;
  font-weight: 600;
}

/* 数量:等宽数字,不铺胶囊 —— 列头窄,横向空间要留给日期 */
.count {
  color: var(--text-dim);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.add {
  margin-left: auto;
  width: 26px;
  height: 26px;
  border-radius: var(--radius-control);
  color: var(--text-dim);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.add:hover {
  background: var(--hover);
  color: var(--accent);
}

/* 列内留白:卡片间距 8px(margin-bottom) + 10px 内边距,列与列之间不再额外加 margin */
.content {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 10px;
  min-height: 0;
}

/* BFC:卡片/组标题的外边距否则会折叠逃出盒子,offsetHeight 恒少 8~14px,
   前缀和逐行累积后长列滚动会整块上移、底部留大片空白 */
.vrow {
  display: flow-root;
}

/* 优先级组头固定 28px —— BoardColumn 的 HEAD_ESTIMATE 按这个值估算初始高度 */
.group-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 28px;
  margin-bottom: 4px;
  font-size: 12px;
  color: var(--text-dim);
}

.gcount {
  color: var(--text-mute);
}

.empty-col {
  margin-top: 24px;
  text-align: center;
  color: var(--text-mute);
  font-size: 12px;
}
</style>
