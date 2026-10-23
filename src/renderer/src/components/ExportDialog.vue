<script setup lang="ts">
/**
 * 导出为 Markdown / CSV。文本由 @shared/export-text 生成(纯函数,格式定死),
 * 这里只负责挑范围与内容、构造默认文件名。回收站项永不出现在导出里。
 */
import { computed, ref } from 'vue'
import { CH } from '@shared/api'
import { today } from '@shared/dates'
import { csvOf, markdownOf } from '@shared/export-text'
import { filterActive, sortedByIndex, viewTitle } from '@shared/query'
import { ACTIVE, INBOX_NAME, TRASH, type ViewKey } from '@shared/types'
import { state } from '../store/data'
import { index } from '../store/index'
import { toast, ui } from '../store/ui'
import { useDialogFocus } from '../lib/dialog-focus'

const scope = ref<'view' | 'all'>('view')
const content = ref<'open' | 'all'>('open')
const rootEl = ref<HTMLElement | null>(null)

function closeExport(): void {
  ui.exportOpen = false
}

/** 初始焦点给范围下拉:导出这一步唯一的选择就是「导什么」 */
function focusScope(): HTMLElement | null {
  return rootEl.value?.querySelector<HTMLElement>('[data-testid="export-scope"]') ?? null
}

const { isTopmost } = useDialogFocus(rootEl, closeExport, focusScope)

const filtered = computed(() => filterActive(ui.taskFilter))
const scopeTitle = computed(() => {
  if (scope.value === 'all') return '全部'
  // 有筛选时标题带上后缀:文件名、Markdown 标题、用户回看导出件都靠它区分口径
  return viewTitle(state.store, ui.view) + (filtered.value ? '-已筛选' : '')
})

/** 导出用清单名:收集箱('' 的 lid)按 INBOX_NAME 显示 */
const listNameOf = (lid: string): string =>
  lid === '' ? INBOX_NAME : (state.store.lists.find((l) => l.id === lid)?.name ?? INBOX_NAME)

const rows = computed(() => {
  // 「全部」范围不看当前视图(也不吃新增的两维筛选:它是「全导」,不是当前视角),
  // 内置视图都只筛 ACTIVE(已完成/已放弃各有自己的视图),直接取 all 视图会永远
  // 导不出已完成项 —— 这里按 未完成 → 已完成 → 已放弃三段拼,
  // Markdown 侧还会按日期重新分组,所以段序只影响 CSV 的行序。
  const all =
    scope.value === 'all'
      ? [
          ...sortedByIndex(index.value, 'all'),
          ...sortedByIndex(index.value, 'done'),
          ...sortedByIndex(index.value, 'dropped')
        ]
      : sortedByIndex(index.value, ui.view as ViewKey, null, ui.taskFilter)
  // 回收站项不进导出;「仅未完成」再剔掉已完成/已放弃
  return all.filter((t) => (content.value === 'open' ? t.status === ACTIVE : t.status !== TRASH))
})

async function exportAs(format: 'md' | 'csv'): Promise<void> {
  const list = rows.value
  if (list.length === 0) {
    toast('没有可导出的任务')
    return
  }
  const text =
    format === 'md' ? markdownOf(list, scopeTitle.value, Date.now()) : csvOf(list, listNameOf)
  const name = `迷你待办-${scopeTitle.value}-${today()}.${format}`
  const res = (await window.todoAPI.invoke(CH.storeExportText, { text, format, name })) as {
    ok: boolean
    canceled?: boolean
    path?: string
    error?: string
  }
  if (!res.ok) {
    toast(`导出失败：${res.error ?? '未知原因'}`)
    return
  }
  if (res.canceled) return
  ui.exportOpen = false
  toast(`已导出到 ${res.path ?? ''}`)
}
</script>

<template>
  <Teleport to="body">
    <div class="overlay" data-testid="export-dialog" :inert="isTopmost ? undefined : true" @click.self="ui.exportOpen = false">
      <div
        ref="rootEl"
        class="dialog"
        role="dialog"
        aria-labelledby="export-dialog-title"
        :aria-modal="isTopmost ? 'true' : undefined"
        style="--dialog-width: 480px"
      >
        <h2 id="export-dialog-title">导出为文本</h2>

        <label class="field">
          <span class="lbl">范围</span>
          <select v-model="scope" data-testid="export-scope">
            <option value="view">当前视图（含搜索与筛选）</option>
            <option value="all">全部（忽略视图与筛选）</option>
          </select>
        </label>

        <label class="field">
          <span class="lbl">内容</span>
          <select v-model="content" data-testid="export-content">
            <option value="open">仅未完成</option>
            <option value="all">含已完成</option>
          </select>
        </label>

        <p class="hint">共 {{ rows.length }} 条（回收站里的任务不会导出）。</p>

        <div class="foot">
          <span class="spacer" />
          <button class="btn" data-testid="export-cancel" @click="ui.exportOpen = false">取消</button>
          <button class="btn" data-testid="export-md" @click="exportAs('md')">导出 Markdown</button>
          <button class="btn primary" data-testid="export-csv" @click="exportAs('csv')">导出 CSV</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.overlay {
  /* 105:低于 ConfirmDialog 的 110,"替换/合并"确认框不会被压在下面 */
  z-index: 105;
}

h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.field {
  display: block;
  margin-bottom: 12px;
}

.lbl {
  display: block;
  margin-bottom: 5px;
  color: var(--text-dim);
  font-size: 12px;
}

.field select {
  width: 100%;
  min-height: 32px;
}

.hint {
  margin: 0;
  color: var(--text-dim);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
</style>
