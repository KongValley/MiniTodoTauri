<script setup lang="ts">
/**
 * 导出为 Markdown / CSV。文本由 @shared/export-text 生成(纯函数,格式定死),
 * 这里只负责挑范围与内容、构造默认文件名。回收站项永不出现在导出里。
 */
import { computed, ref } from 'vue'
import { CH } from '@shared/api'
import { today } from '@shared/dates'
import { csvOf, markdownOf } from '@shared/export-text'
import { sortedByIndex, viewTitle } from '@shared/query'
import { ACTIVE, INBOX_NAME, TRASH, type ViewKey } from '@shared/types'
import { state } from '../store/data'
import { index } from '../store/index'
import { toast, ui } from '../store/ui'

const scope = ref<'view' | 'all'>('view')
const content = ref<'open' | 'all'>('open')

const scopeTitle = computed(() => (scope.value === 'all' ? '全部' : viewTitle(state.store, ui.view)))

/** 导出用清单名:收集箱('' 的 lid)按 INBOX_NAME 显示 */
const listNameOf = (lid: string): string =>
  lid === '' ? INBOX_NAME : (state.store.lists.find((l) => l.id === lid)?.name ?? INBOX_NAME)

const rows = computed(() => {
  // 「全部」范围不看当前视图:内置视图都只筛 ACTIVE(已完成/已放弃各有自己的视图),
  // 直接取 all 视图会永远导不出已完成项 —— 这里按 未完成 → 已完成 → 已放弃三段拼,
  // Markdown 侧还会按日期重新分组,所以段序只影响 CSV 的行序。
  const all =
    scope.value === 'all'
      ? [
          ...sortedByIndex(index.value, 'all'),
          ...sortedByIndex(index.value, 'done'),
          ...sortedByIndex(index.value, 'dropped')
        ]
      : sortedByIndex(index.value, ui.view as ViewKey)
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
    <div class="overlay" data-testid="export-dialog" @click.self="ui.exportOpen = false">
      <div class="dialog">
        <h2>导出为文本</h2>

        <label class="field">
          <span class="lbl">范围</span>
          <select v-model="scope" data-testid="export-scope">
            <option value="view">当前视图（{{ viewTitle(state.store, ui.view) }}）</option>
            <option value="all">全部</option>
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
  position: fixed;
  inset: 0;
  background: rgb(0 0 0 / 35%);
  display: flex;
  align-items: center;
  justify-content: center;
  /* 105:低于 ConfirmDialog 的 110 */
  z-index: 105;
}

.dialog {
  width: 420px;
  padding: 18px 20px 14px;
  border-radius: 10px;
  background: var(--card);
  border: 1px solid var(--line);
  box-shadow: 0 12px 40px rgb(0 0 0 / 25%);
}

h2 {
  margin: 0 0 14px;
  font-size: 15px;
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
}

.hint {
  margin: 0 0 12px;
  color: var(--text-dim);
  font-size: 12px;
}

.foot {
  display: flex;
  align-items: center;
  gap: 8px;
}

.spacer {
  flex: 1 1 auto;
}

.btn {
  padding: 5px 12px;
  border-radius: 6px;
  border: 1px solid var(--field-line);
  background: var(--card);
  color: var(--text);
  font-size: 12px;
}

.btn:hover {
  background: var(--hover);
}

.btn.primary {
  border-color: var(--accent);
  background: var(--accent);
  color: #fff;
}
</style>
