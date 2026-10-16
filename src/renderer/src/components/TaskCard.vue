<script setup lang="ts">
import { computed, ref } from 'vue'

import { completeTodo, toggleSubtask } from '@shared/store-ops'
import { overdueDays } from '@shared/dates'
import { PRIO_NAME, REPEAT_NAME, type TodoItem } from '@shared/types'
import { mutate } from '../store/data'
import { openCardMenu, requestEdit, ui } from '../store/ui'
import { segments } from '../lib/search'
import Icon from './Icon.vue'

const props = defineProps<{
  item: TodoItem
  /** 清单名与色由父组件从索引取好传入,避免每条卡片各自扫 store */
  listName: string
  listColor: string
  /** 日期标签:同列卡片日期相同,由父组件算一次传入(label() 含日期解析,逐卡重算很贵) */
  dateLabel: string
}>()

const prioName = computed(() => PRIO_NAME[props.item.prio])
const repeatName = computed(() => REPEAT_NAME[props.item.repeat.kind])
const subDone = computed(() => props.item.subtasks.filter((s) => s.done).length)
const isDone = computed(() => props.item.status === 1)
const hl = computed(() => segments(props.item.title, ui.search))
const subPct = computed(() => (props.item.subtasks.length ? (subDone.value / props.item.subtasks.length) * 100 : 100))
const flagName = computed(() => (props.item.prio === 1 ? 'flagHigh' : props.item.prio === 2 ? 'flagMid' : 'flagLow'))
/** 逾期天数:只对未完成任务显示(已完成/已放弃的历史项不该报「逾期」) */
const od = computed(() => (props.item.status === 0 ? overdueDays(props.item.date) : 0))

/** ponytail: 展开态只存在组件内;虚拟滚动会卸载屏幕外卡片,滚走即收起,可接受 */
const expanded = ref(false)

function onComplete(event: MouseEvent): void {
  event.stopPropagation()
  if (isDone.value) return
  void mutate((s) => completeTodo(s, props.item.id))
}

function onOpen(): void {
  requestEdit(props.item.id)
}

function onCtx(event: MouseEvent): void {
  event.stopPropagation()
  // 位置钳制交给菜单自己(它按实测尺寸钳):这里先猜宽高就会在右下角被裁
  openCardMenu(props.item.id, event.clientX, event.clientY)
}
</script>

<template>
  <article
    class="card"
    :class="{ done: isDone }"
    :data-card="item.id"
    :data-prio="item.prio"
    draggable="true"
    @click="onOpen"
    @contextmenu.prevent="onCtx"
  >
    <button
      class="circle"
      :class="{ checked: isDone }"
      :data-complete="item.id"
      :aria-label="isDone ? '标记为未完成' : '标记为完成'"
      @click="onComplete"
    >
      <span class="ring"><Icon v-if="isDone" name="check" :size="12" /></span>
    </button>

    <button
      v-if="item.note || item.subtasks.length > 0"
      class="expand"
      :data-expand="item.id"
      :aria-label="expanded ? '收起详情' : '展开详情'"
      :title="expanded ? '收起详情' : '展开详情'"
      @click.stop="expanded = !expanded"
    >
      <Icon :name="expanded ? 'collapse' : 'expand'" :size="12" />
    </button>

    <div class="body">
      <div class="title">
        <button class="title-btn" :aria-label="`编辑任务：${item.title}`" @click.stop="onOpen">
          <span v-for="(s, i) in hl" :key="i" :class="{ hl: s.hit }">{{ s.t }}</span>
        </button>
      </div>
      <div class="meta">
        <span class="date">{{ dateLabel }}</span>
        <span v-if="od > 0" class="overdue" data-overdue>逾期 {{ od }} 天</span>
        <span class="list"><i class="dot" :style="{ background: listColor }" />{{ listName }}</span>
        <span v-if="item.subtasks.length > 0" class="subs" data-subs>{{ subDone }}/{{ item.subtasks.length }}</span>
        <span class="prio" :class="`p${item.prio}`">
          <Icon :name="flagName" :size="12" />{{ prioName }}
        </span>
        <span v-if="item.repeat.kind !== 'none'" class="repeat" data-repeat>{{ repeatName }}</span>
      </div>
      <div v-if="item.note && !expanded" class="note">{{ item.note }}</div>

      <template v-if="expanded">
        <div v-if="item.note" class="note full" data-note-full>{{ item.note }}</div>
        <div v-if="item.subtasks.length > 0" class="bar" :data-bar="item.id"><i :style="{ width: subPct + '%' }" /></div>
        <button
          v-for="s in item.subtasks"
          :key="s.id"
          class="sub"
          :data-sub="s.id"
          @click.stop="void mutate((x) => toggleSubtask(x, item.id, s.id))"
        >
          <span class="box" :class="{ on: s.done }"><Icon v-if="s.done" name="check" :size="10" /></span>
          <span class="st" :class="{ done: s.done }">{{ s.title }}</span>
        </button>
      </template>
    </div>
  </article>
</template>

<style scoped>
.card {
  display: flex;
  gap: 10px;
  padding: 12px 14px;
  margin-bottom: 10px;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-card);
  cursor: pointer;
  /* 展开钮绝对定位的参照 */
  position: relative;
}

/* hover 只动边线/底色/阴影:不做位移或缩放,长列表里不抖 */
.card:hover {
  border-color: var(--accent);
  background: var(--hover);
}

.card.done .title {
  text-decoration: line-through;
  color: var(--text-dim);
}

.expand {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-control);
  background: none;
  color: var(--text-mute);
  line-height: 28px;
  cursor: pointer;
}

.expand:hover {
  background: var(--hover);
  color: var(--text);
}

.hl {
  background: var(--sel);
  border-radius: 2px;
}

/* 完成按钮:28×28 的点击区,视觉还是一个 18px 的圆 */
.circle {
  flex: 0 0 28px;
  width: 28px;
  height: 28px;
  margin: -4px 0 0 -4px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.ring {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 1.5px solid var(--thumb-hot);
  display: flex;
  align-items: center;
  justify-content: center;
}

.circle:hover .ring {
  border-color: var(--accent);
}

.circle.checked .ring {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--on-accent);
}

.body {
  min-width: 0;
  flex: 1 1 auto;
}

.title {
  font-size: 14px;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
}

/* 标题本身就是原生按钮:键盘能聚焦、回车即打开,外层卡片点击仍然可用 */
.title-btn {
  display: block;
  width: 100%;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: none;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.meta {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 8px;
  font-size: 12px;
  color: var(--text-dim);
  flex-wrap: wrap;
}

/* 日期与列头重复,压到最弱;真正要看的是清单/优先级/重复 */
.date {
  color: var(--text-mute);
}

.dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  margin-right: 5px;
}

.prio {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.prio.p1 {
  color: var(--prio-1);
}

.prio.p2 {
  color: var(--prio-2);
}

.prio.p3 {
  color: var(--prio-3);
}

/* 重复任务标记:低饱和胶囊,与列表行同一视觉语言 */
.repeat {
  padding: 1px 7px;
  border-radius: 9px;
  background: var(--accent-soft);
  color: var(--text-dim);
}

.subs {
  padding: 1px 6px;
  border-radius: 9px;
  background: var(--sel);
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
}

.note {
  margin-top: 6px;
  font-size: 12px;
  color: var(--text-mute);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.note.full {
  white-space: pre-wrap;
}

.bar {
  height: 4px;
  margin: 8px 0 6px;
  border-radius: 2px;
  background: var(--track);
  overflow: hidden;
}

.bar > i {
  display: block;
  height: 100%;
  background: var(--accent);
}

.sub {
  display: flex;
  gap: 6px;
  align-items: flex-start;
  width: 100%;
  padding: 3px 0;
  border: 0;
  background: none;
  color: var(--text-dim);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.box {
  flex: 0 0 14px;
  width: 14px;
  height: 14px;
  margin-top: 1px;
  border: 1px solid var(--thumb-hot);
  border-radius: 3px;
  font-size: 10px;
  line-height: 12px;
  text-align: center;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.box.on {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--on-accent);
}

.st {
  min-width: 0;
  word-break: break-word;
}

.st.done {
  text-decoration: line-through;
  color: var(--text-mute);
}
</style>
