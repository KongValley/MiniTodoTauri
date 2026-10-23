<script setup lang="ts">
import { computed, ref } from 'vue'
import { VIEWS, VIEW_NAME, TRASH, type TodoGroup, type TodoList, type ViewKey } from '@shared/types'
import {
  addGroup,
  freeListColor,
  moveGroup,
  moveList,
  removeGroup,
  removeList,
  removeTodos
} from '@shared/store-ops'
import { mutate, state, undoLast } from '../store/data'
import { index } from '../store/index'
import { setView } from '../lib/keymap'
import {
  askConfirm,
  requestEditGroup,
  requestEditList,
  requestNewGroup,
  requestNewList,
  toast,
  ui
} from '../store/ui'
import Icon from './Icon.vue'

/** 视图 → 图标名;这 8 个在 Icon.vue 的 PART 表里,自带 --ico-* 配色 */
const VIEW_ICON_NAME: Record<string, string> = {
  all: 'all',
  today: 'today',
  tmr: 'tmr',
  week7: 'week7',
  inbox: 'inbox',
  done: 'done',
  dropped: 'dropped',
  trash: 'trash'
}

const primaryViews = VIEWS.slice(0, 5)
const statusViews = VIEWS.slice(5)

/** 计数全部来自单次扫描的索引,不再逐行全量扫描 */
function countOf(view: ViewKey): number {
  return index.value.counts[view] ?? 0
}

function groupCount(gid: string): number {
  return index.value.counts[`group:${gid}`] ?? 0
}

function isActive(view: ViewKey): boolean {
  return ui.view === view
}

function toggleGroup(gid: string): void {
  ui.collapsed[gid] = !ui.collapsed[gid]
}

// 分组本身也按 order 排:数组序只是存储顺序,用户看到的顺序由 order 决定
const listsByGroup = computed(() =>
  [...state.store.groups]
    .sort((a, b) => a.order - b.order)
    .map((g) => ({
      group: g,
      lists: state.store.lists.filter((l) => l.gid === g.id).sort((a, b) => a.order - b.order)
    }))
)

/* ---------- 新建 ---------- */

/** 停在某分组视图上时,新清单默认落在该组;否则落到第一个分组 */
function targetGid(): string {
  const view = ui.view.startsWith('group:') ? ui.view.slice(6) : ''
  if (view && state.store.groups.some((g) => g.id === view)) return view
  return state.store.groups[0]?.id ?? ''
}

function onAddList(): void {
  const gid = targetGid()
  requestNewList(gid, freeListColor(state.store, gid))
}

/* ---------- 删除 ---------- */

/** 清空回收站:彻底删除全部回收站项,不可恢复,必须二次确认 */
function onEmptyTrash(): void {
  const ids = state.store.todos.filter((t) => t.status === TRASH).map((t) => t.id)
  if (ids.length === 0) {
    toast('回收站是空的')
    return
  }
  askConfirm('清空回收站', `将彻底删除 ${ids.length} 条任务，无法恢复。`, () => {
    void mutate((s) => removeTodos(s, ids, true)).then(() =>
      toast(`已清空回收站（${ids.length} 条）`, { label: '撤销', run: () => void undoLast() })
    )
  })
}

function askRemoveList(l: TodoList): void {
  const n = state.store.todos.filter((t) => t.lid === l.id).length
  const done = (dropTodos: boolean): void => {
    void mutate((s) => removeList(s, l.id, dropTodos).store).then(() => {
      toast(
        dropTodos
          ? `已删除清单「${l.name}」，${n} 条任务已移入回收站`
          : n > 0
            ? `已删除清单「${l.name}」，${n} 条任务已移到收集箱`
            : `已删除清单「${l.name}」`
      )
    })
    if (ui.view === `list:${l.id}`) setView('all')
  }
  // 没有任务时不必二选一
  if (n === 0) {
    askConfirm('删除清单', `删除「${l.name}」？`, () => done(false))
    return
  }
  askConfirm(
    '删除清单',
    `「${l.name}」下还有 ${n} 条任务。删除后这些任务怎么办？（两条路径都不丢数据）`,
    () => done(true),
    { label: `任务移到收集箱（${n} 条）`, onOk: () => done(false) }
  )
}

function askRemoveGroup(g: TodoGroup): void {
  const lists = state.store.lists.filter((l) => l.gid === g.id)
  const ids = new Set(lists.map((l) => l.id))
  const n = state.store.todos.filter((t) => ids.has(t.lid)).length
  askConfirm(
    '删除分组',
    `删除「${g.name}」？组内 ${lists.length} 个清单会被一并删除，其中的 ${n} 条任务会移到收集箱（不会丢）。`,
    () => {
      void mutate((s) => removeGroup(s, g.id).store)
      toast(`已删除分组「${g.name}」，${lists.length} 个清单已移除，${n} 条任务已移到收集箱`)
      if (ui.view === `group:${g.id}`) setView('all')
    }
  )
}

/* ---------- 拖拽排序 ---------- */

const dragKind = ref<'group' | 'list' | ''>('')
const dragId = ref('')
const dropMark = ref<{ kind: 'group' | 'list'; id: string; pos: 'above' | 'below' } | null>(null)

function onDragStart(kind: 'group' | 'list', id: string, event: DragEvent): void {
  dragKind.value = kind
  dragId.value = id
  event.dataTransfer?.setData('text/plain', id)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

function onDragOver(kind: 'group' | 'list', id: string, event: DragEvent): void {
  if (dragKind.value === '') return
  // 分组只能落在分组行上,清单可以落在清单行或分组行(落到分组行 = 移到该组末尾)
  if (dragKind.value === 'group' && kind !== 'group') return
  if (dragKind.value === 'list' && kind === 'group') {
    dropMark.value = { kind, id, pos: 'below' }
    return
  }
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const pos = event.clientY < rect.top + rect.height / 2 ? 'above' : 'below'
  dropMark.value = { kind, id, pos }
}

/** 落点 index 一律以「排除被拖项后的同组序列」为基准,与 moveList 的入参同口径 */
function onDrop(): void {
  const mark = dropMark.value
  const id = dragId.value
  const kind = dragKind.value
  dropMark.value = null
  dragKind.value = ''
  dragId.value = ''
  if (!mark || id === '' || id === mark.id) return

  if (kind === 'group') {
    void mutate((s) => {
      const rest = [...s.groups].sort((a, b) => a.order - b.order).filter((g) => g.id !== id)
      const at = rest.findIndex((g) => g.id === mark.id)
      return moveGroup(s, id, at + (mark.pos === 'below' ? 1 : 0))
    })
    return
  }
  // 清单落在分组行 = 移到该组末尾(index 取该组现有清单数)
  if (mark.kind === 'group') {
    const n = state.store.lists.filter((l) => l.gid === mark.id).length
    void mutate((s) => moveList(s, id, mark.id, n))
    return
  }
  const toGid = state.store.lists.find((l) => l.id === mark.id)?.gid ?? ''
  void mutate((s) => {
    const rest = s.lists.filter((l) => l.gid === toGid && l.id !== id).sort((a, b) => a.order - b.order)
    const at = rest.findIndex((l) => l.id === mark.id)
    return moveList(s, id, toGid, at + (mark.pos === 'below' ? 1 : 0))
  })
}

function onDragEnd(): void {
  dragKind.value = ''
  dragId.value = ''
  dropMark.value = null
}

function markClass(kind: 'group' | 'list', id: string): string {
  const m = dropMark.value
  if (!m || m.id !== id) return ''
  return m.pos === 'above' ? 'drop-above' : 'drop-below'
}
</script>

<template>
  <aside class="sidebar" data-testid="sidebar">
    <div class="brand">迷你待办</div>

    <div class="section-title">任务</div>
    <div class="rail">
      <button
        v-for="v in primaryViews"
        :key="v"
        class="row view-row"
        :class="{ active: isActive(v) }"
        :data-view="v"
        :aria-current="isActive(v) ? 'page' : undefined"
        @click="setView(v)"
      >
        <span class="icon"><Icon :name="VIEW_ICON_NAME[v] as string" /></span>
        <span class="name">{{ VIEW_NAME[v] }}</span>
        <span class="num">{{ countOf(v) }}</span>
      </button>
    </div>

    <div class="section-title">
      <span>我的清单</span>
      <button class="add" data-testid="sidebar-add-group" title="新建分组" @click="requestNewGroup()">+ 分组</button>
      <button class="add" data-testid="sidebar-add-list" title="新建清单" @click="onAddList">+ 清单</button>
    </div>

    <!-- 只有清单树滚动:视图与底部入口始终留在视野里 -->
    <div class="rail tree thin-scroll">
      <template v-for="entry in listsByGroup" :key="entry.group.id">
        <div
          class="row group-row"
          :class="[
            { active: isActive(`group:${entry.group.id}` as ViewKey) },
            markClass('group', entry.group.id)
          ]"
          :data-group="entry.group.id"
          draggable="true"
          @dragstart="onDragStart('group', entry.group.id, $event)"
          @dragover.prevent="onDragOver('group', entry.group.id, $event)"
          @drop.prevent="onDrop"
          @dragend="onDragEnd"
        >
          <button
            class="arrow-btn"
            :data-arrow="entry.group.id"
            :aria-expanded="!ui.collapsed[entry.group.id]"
            :aria-label="ui.collapsed[entry.group.id] ? '展开分组' : '收起分组'"
            :title="ui.collapsed[entry.group.id] ? '展开分组' : '收起分组'"
            @click.stop="toggleGroup(entry.group.id)"
          >
            <span class="arrow" :class="{ collapsed: ui.collapsed[entry.group.id] }">▾</span>
          </button>
          <button class="row-main" @click="setView(`group:${entry.group.id}` as ViewKey)">
            <span class="name">{{ entry.group.name }}</span>
            <span class="num">{{ groupCount(entry.group.id) }}</span>
          </button>
          <button
            class="act"
            :data-group-edit="entry.group.id"
            title="重命名分组"
            aria-label="重命名分组"
            @click.stop="requestEditGroup(entry.group.id, entry.group.name)"
          >
            <Icon name="edit" :size="12" />
          </button>
          <button
            class="act danger"
            :data-group-del="entry.group.id"
            title="删除分组"
            aria-label="删除分组"
            @click.stop="askRemoveGroup(entry.group)"
          >
            <Icon name="trash" :size="12" />
          </button>
        </div>

        <div
          v-for="l in entry.lists"
          v-show="!ui.collapsed[entry.group.id]"
          :key="l.id"
          class="row list-row"
          :class="[
            { active: isActive(`list:${l.id}` as ViewKey) },
            markClass('list', l.id)
          ]"
          :data-list="l.id"
          draggable="true"
          @dragstart="onDragStart('list', l.id, $event)"
          @dragover.prevent="onDragOver('list', l.id, $event)"
          @drop.prevent="onDrop"
          @dragend="onDragEnd"
        >
          <button class="row-main" @click="setView(`list:${l.id}` as ViewKey)">
            <span class="dot" :style="{ background: l.color }" />
            <span class="name">{{ l.name }}</span>
            <span class="num">{{ countOf(`list:${l.id}` as ViewKey) }}</span>
          </button>
          <button
            class="act"
            :data-list-edit="l.id"
            title="编辑清单"
            aria-label="编辑清单"
            @click.stop="requestEditList(l.id, l.name, l.gid, l.color)"
          >
            <Icon name="edit" :size="12" />
          </button>
          <button
            class="act danger"
            :data-list-del="l.id"
            title="删除清单"
            aria-label="删除清单"
            @click.stop="askRemoveList(l)"
          >
            <Icon name="trash" :size="12" />
          </button>
        </div>
      </template>
    </div>

    <div class="section-title">归档</div>
    <div class="rail status-rail">
      <template v-for="v in statusViews" :key="v">
        <button
          v-if="v !== 'trash'"
          class="row view-row"
          :class="{ active: isActive(v) }"
          :data-view="v"
          :aria-current="isActive(v) ? 'page' : undefined"
          @click="setView(v)"
        >
          <span class="icon"><Icon :name="VIEW_ICON_NAME[v] as string" /></span>
          <span class="name">{{ VIEW_NAME[v] }}</span>
          <span class="num">{{ countOf(v) }}</span>
        </button>
        <div v-else class="row view-row" :class="{ active: isActive(v) }">
          <button
            class="row-main"
            :data-view="v"
            :aria-current="isActive(v) ? 'page' : undefined"
            @click="setView(v)"
          >
            <span class="icon"><Icon :name="VIEW_ICON_NAME[v] as string" /></span>
            <span class="name">{{ VIEW_NAME[v] }}</span>
            <span class="num">{{ countOf(v) }}</span>
          </button>
          <button
            v-if="countOf('trash') > 0"
            class="act danger"
            data-testid="empty-trash"
            title="清空回收站"
            aria-label="清空回收站"
            @click.stop="onEmptyTrash"
          >
            <Icon name="trash" :size="12" />
          </button>
        </div>
      </template>
    </div>

    <div class="rail tools">
      <button class="btn tool" data-testid="open-settings" title="设置" aria-label="设置" @click="ui.settingsOpen = true">
        <Icon name="settings" :size="14" />设置
      </button>
      <button class="btn tool" data-testid="open-help" title="快捷键" aria-label="快捷键" @click="ui.helpOpen = true">
        <Icon name="help" :size="14" />快捷键
      </button>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  display: flex;
  flex-direction: column;
  background: var(--panel);
  border-right: 1px solid var(--line);
  overflow: hidden;
}

.brand {
  display: flex;
  align-items: center;
  height: 56px;
  padding: 0 12px;
  font-size: 15px;
  font-weight: 600;
  border-bottom: 1px solid var(--line);
}

.rail {
  padding: 4px 8px;
}

/* 只有清单树会滚动:视图、归档与底部入口永远可见 */
.tree {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}

.status-rail {
  flex: 0 0 auto;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 12px 10px 4px;
  color: var(--text-mute);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.section-title .add {
  min-height: 22px;
  padding: 0 6px;
  border-radius: var(--radius-control);
  font-size: 11px;
  color: var(--text-mute);
  border: 1px solid transparent;
}

.section-title .add:hover {
  color: var(--accent);
  border-color: var(--field-line);
  background: var(--hover);
}

/* 行容器不接收点击(点击交给里面的主按钮),但它承载拖拽与落点指示 */
.row {
  display: flex;
  align-items: center;
  gap: 2px;
  width: 100%;
  height: 32px;
  padding: 0 6px 0 8px;
  border-radius: var(--radius-control);
  color: var(--text);
}

.row:hover {
  background: var(--hover);
}

/* 当前视图:底色 + 左侧 accent 标记,不靠加粗撑辨识 */
.row.active {
  background: var(--accent-soft);
  color: var(--text);
  font-weight: 600;
  box-shadow: inset 2px 0 0 var(--accent);
}

/* 主按钮:名称 + 计数都归它,整行看上去还是一行 */
.row-main {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1 1 auto;
  min-width: 0;
  height: 32px;
  padding: 0;
  border-radius: var(--radius-control);
  color: inherit;
  text-align: left;
  font: inherit;
}

/* 行内操作:默认透明占位,悬停或键盘聚焦时显形。用 opacity 而非 display:none,
   否则行宽会随悬停跳动。按钮彼此是兄弟节点,不嵌套、不重叠。 */
.act {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 24px;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  color: var(--text-mute);
  opacity: 0;
}

.row:hover .act,
.row:focus-within .act {
  opacity: 1;
}

.act:hover {
  background: var(--card);
  color: var(--accent);
}

.act.danger:hover {
  color: var(--danger);
}

.arrow-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 22px;
  width: 22px;
  height: 22px;
  border-radius: 4px;
  color: var(--text-dim);
}

.arrow-btn:hover {
  background: var(--card);
  color: var(--text);
}

/* 拖拽落点指示线 */
.drop-above {
  box-shadow: inset 0 2px 0 var(--accent);
}

.drop-below {
  box-shadow: inset 0 -2px 0 var(--accent);
}

.icon {
  display: inline-flex;
  align-items: center;
  width: 16px;
  height: 16px;
  flex: 0 0 16px;
}

.icon > svg {
  display: block;
}

.name {
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 计数:等宽数字右对齐,不铺大胶囊 —— 一眼比大小,不吃横向空间 */
.num {
  flex: 0 0 auto;
  min-width: 20px;
  padding-right: 2px;
  color: var(--text-dim);
  font-size: 12px;
  font-weight: 400;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.list-row {
  padding-left: 22px;
}

/* 窄窗口(最小 900px):侧栏只有 192px,而行内两个操作钮常年占位(悬停才显形),
   清单树一旦可滚动还要再让出 10px 滚动条 —— 「内容生产」这种四字名会被截成「内容…」。
   这里把缩进、内边距与计数字段的预留一起收紧,给名字让出 ~20px。 */
@media (max-width: 1100px) {
  .rail {
    padding: 4px 6px;
  }

  .row {
    padding: 0 4px 0 6px;
  }

  .list-row {
    padding-left: 18px;
  }

  .section-title {
    padding-left: 8px;
  }

  .num {
    min-width: 14px;
    padding-right: 0;
  }
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: 0 0 8px;
}

.tools {
  display: flex;
  gap: 6px;
  flex: 0 0 auto;
  margin-top: 6px;
  padding: 8px;
  border-top: 1px solid var(--line);
}

.tools .tool {
  flex: 1 1 0;
  min-width: 0;
  padding: 0 6px;
  font-size: 12px;
  color: var(--text-dim);
}

.arrow {
  width: 12px;
  font-size: 12px;
  line-height: 1;
  color: var(--text-dim);
  transition: transform 120ms ease;
}

.arrow.collapsed {
  transform: rotate(-90deg);
}

.group-row {
  font-weight: 600;
}

</style>
