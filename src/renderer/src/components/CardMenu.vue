<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { addDays, today } from '@shared/dates'
import { completeTodo, duplicateTodo, moveCard, removeTodos, setStatus, updateTodo } from '@shared/store-ops'
import { ACTIVE, INBOX_NAME, PRIO_NAME, type Prio } from '@shared/types'
import { mutate, undoLast, state } from '../store/data'
import { askConfirm, closeCardMenu, requestEdit, toast, ui } from '../store/ui'
import { isComposingEvent } from '../lib/input-events'
import Icon from './Icon.vue'

const m = computed(() => ui.cardMenu as { id: string; x: number; y: number })
const item = computed(() => state.store.todos.find((t) => t.id === m.value.id))
/** 「移动到」选择框的值(打开菜单时为空 = 保持原清单) */
const cardList = ref('')

const menuEl = ref<HTMLElement | null>(null)
/** 打开浮层前谁拿着焦点:Esc 收起时还给它 */
let trigger: HTMLElement | null = null
/** 视口安全边距(px):贴边时不至于被裁掉 */
const SAFE = 8
const pos = ref({ left: 0, top: 0 })

/** 动作收尾:收起菜单并把焦点还给触发控件(打开弹窗的动作不适用——焦点归弹窗) */
function closeAndRestore(): void {
  const back = trigger
  closeCardMenu()
  void nextTick(() => {
    // 触发控件可能已被移除(动作把它带出了当前视图)或变成了禁用态(无意义) —— 那就别抢焦点
    if (back && back.isConnected && back !== document.body && !(back as HTMLButtonElement).disabled) back.focus()
  })
}

/** 用实测尺寸钳制位置,不再猜菜单宽高(猜错就会在右下角被裁) */
async function place(): Promise<void> {
  await nextTick()
  const el = menuEl.value
  if (!el) return
  const maxLeft = Math.max(SAFE, window.innerWidth - el.offsetWidth - SAFE)
  const maxTop = Math.max(SAFE, window.innerHeight - el.offsetHeight - SAFE)
  pos.value = {
    left: Math.min(Math.max(SAFE, m.value.x), maxLeft),
    top: Math.min(Math.max(SAFE, m.value.y), maxTop)
  }
}

onMounted(() => {
  trigger = document.activeElement as HTMLElement | null
  window.addEventListener('keydown', onWindowKeyDown)
  void place().then(() => {
    // 打开即聚焦第一个可用操作:Tab/回车马上可用,不用先点一下
    menuEl.value?.querySelector<HTMLElement>('button:not([disabled]), select:not([disabled])')?.focus()
  })
})

onBeforeUnmount(() => window.removeEventListener('keydown', onWindowKeyDown))

watch(() => [m.value.x, m.value.y, m.value.id], () => void place())

/**
 * Esc 收起并把焦点还给触发控件。
 * 挂在 window 上而不是面板自身:焦点在不在面板里都要能收,
 * 且必须自己吞掉这次事件(全局 keydown 先于本处注册,已在 keymap 里让位)。
 */
function onWindowKeyDown(e: KeyboardEvent): void {
  if (e.key !== 'Escape' || isComposingEvent(e)) return
  e.preventDefault()
  e.stopPropagation()
  closeAndRestore()
}

/** 焦点已经离开浮层(点了别处 / Tab 走了):收起,但不把焦点拉回来 */
function onFocusOut(e: FocusEvent): void {
  const next = e.relatedTarget as Node | null
  if (next && menuEl.value?.contains(next)) return
  closeCardMenu()
}

const px = (v: number): string => `${v}px`

interface Action {
  label: string
  icon: string
  danger?: boolean
  run: () => void
}

/** 索引处的插入位一律给桶尾(moveCard 内部越界钳到 [0, n]) */
const TAIL = Number.MAX_SAFE_INTEGER

function reschedule(date: string, label: string): void {
  const id = m.value.id
  void mutate((s) => moveCard(s, id, date, TAIL)).then(() => toast(`已改期：${label}`))
  closeAndRestore()
}

function setPrio(prio: Prio): void {
  const id = m.value.id
  void mutate((s) => updateTodo(s, id, { prio })).then(() => toast(`优先级：${PRIO_NAME[prio]}`))
  closeAndRestore()
}

function complete(): void {
  const id = m.value.id
  const done = item.value?.status === 1
  void mutate((s) => (done ? setStatus(s, id, ACTIVE) : completeTodo(s, id)))
  closeAndRestore()
}

function remove(): void {
  const id = m.value.id
  const purge = ui.view === 'trash'
  closeCardMenu()
  askConfirm(
    purge ? '彻底删除' : '移入回收站',
    purge ? '将彻底删除 1 条任务，无法恢复。' : '将 1 条任务移入回收站。',
    () => {
      void mutate((s) => removeTodos(s, [id], purge)).then(() =>
        toast(`已${purge ? '彻底删除' : '移入回收站'} 1 条`, { label: '撤销', run: () => void undoLast() })
      )
    }
  )
}

function edit(): void {
  requestEdit(m.value.id)
  closeCardMenu()
}

/** 复制任务:同标题同清单同日期,子任务重置为未完成 */
function duplicate(): void {
  const id = m.value.id
  void mutate((s) => duplicateTodo(s, id)).then(() => toast('已复制为一条新任务'))
  closeAndRestore()
}

/** 「移动到」清单(收集箱 = ''),与批量菜单同一个 updateTodo(lid) 路径 */
function moveToList(): void {
  const id = m.value.id
  const lid = cardList.value
  const name = state.store.lists.find((l) => l.id === lid)?.name ?? INBOX_NAME
  void mutate((s) => updateTodo(s, id, { lid })).then(() => toast(`已移动到「${name}」`))
  closeAndRestore()
}

const lists = computed(() => state.store.lists)

const actions = computed<Action[]>(() => {
  if (!item.value) return []
  const done = item.value.status === 1
  return [
    { label: '编辑', icon: 'edit', run: edit },
    { label: '复制任务', icon: 'copy', run: duplicate },
    { label: '改期到今天', icon: 'today', run: () => reschedule(today(), '今天') },
    { label: '改期到明天', icon: 'tmr', run: () => reschedule(addDays(today(), 1), '明天') },
    { label: '改期到后天', icon: 'calendar', run: () => reschedule(addDays(today(), 2), '后天') },
    { label: '不排期', icon: 'inbox', run: () => reschedule('', '未排期') },
    { label: done ? '取消完成' : '完成', icon: 'check', run: complete },
    { label: '删除', icon: 'trash', danger: true, run: remove }
  ]
})

// 卡片被键盘删掉后 ui.cardMenu 仍非 null,App 的 v-if 会一直挂着这个空壳菜单
watch(item, (v) => {
  if (!v) closeCardMenu()
})
</script>

<template>
  <Teleport to="body">
    <div
      class="backdrop"
      data-testid="card-menu-backdrop"
      @click="closeCardMenu"
      @contextmenu.prevent="closeCardMenu"
    >
      <div
        ref="menuEl"
        class="menu"
        data-testid="card-menu"
        :style="{ left: px(pos.left), top: px(pos.top) }"
        role="group"
        aria-label="任务操作"
        @click.stop
        @focusout="onFocusOut"
      >
        <button
          v-for="(a, i) in actions"
          :key="i"
          class="mi"
          :class="{ danger: a.danger }"
          :data-menu="a.label"
          @click="a.run"
        >
          <Icon :name="a.icon" :size="14" class="mi-ico" />
          <span>{{ a.label }}</span>
        </button>
        <div class="mi-row" role="group" aria-label="设置优先级">
          <button
            v-for="p in [1, 2, 3] as const"
            :key="p"
            class="mi mini"
            :class="`p${p}`"
            :data-menu="PRIO_NAME[p]"
            :title="`设为${PRIO_NAME[p]}优先级`"
            :aria-label="`设为${PRIO_NAME[p]}优先级`"
            @click="setPrio(p)"
          >
            <Icon :name="p === 1 ? 'flagHigh' : p === 2 ? 'flagMid' : 'flagLow'" :size="13" />
            <span>{{ PRIO_NAME[p] }}</span>
          </button>
        </div>
        <div class="row-select">
          <span id="card-menu-list-label" class="lbl">移动到</span>
          <select
            v-model="cardList"
            data-testid="card-menu-list"
            aria-labelledby="card-menu-list-label"
            @change="moveToList"
          >
            <option value="">{{ INBOX_NAME }}</option>
            <option v-for="l in lists" :key="l.id" :value="l.id">{{ l.name }}</option>
          </select>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 120;
}

.menu {
  position: fixed;
  min-width: 180px;
  max-height: calc(100vh - 16px);
  overflow-y: auto;
  padding: 6px;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-popover);
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
  background: none;
  color: var(--text);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.mi:hover {
  background: var(--hover);
}

.mi-ico {
  flex: 0 0 14px;
  color: var(--text-dim);
}

.mi.danger {
  color: var(--danger);
}

.mi.danger .mi-ico {
  color: var(--danger);
}

/* 优先级快捷钮:图标颜色走 token,三档与卡片/列表一致 */
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
  padding: 4px 6px;
  border-top: 1px solid var(--line);
  margin-top: 4px;
}

/* 「移动到」一行:与 BulkMenu 同款,保持两处右键/批量菜单外观一致 */
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

.row-select select {
  flex: 1 1 auto;
  min-width: 0;
}

.mini {
  flex: 1 1 0;
  gap: 4px;
  justify-content: center;
  border: 1px solid var(--line);
  font-size: 12px;
  color: var(--text-dim);
}
</style>
