<script setup lang="ts">
/**
 * 「从备份恢复」：列出 backups/ 下的每日备份，选一份走与导入完全相同的管线
 * （可选「替换 / 合并」，restore 前自动留一份当日备份的是导入管线本身的语义）。
 * 数据模型零新增：备份就是 todos.json 的副本。
 */
import { onMounted, ref } from 'vue'
import { CH } from '@shared/api'
import { stampLabel } from '@shared/dates'
import { importFromDialog } from '../store/data'
import { ui } from '../store/ui'
import { useDialogFocus } from '../lib/dialog-focus'

interface BackupItem {
  name: string
  path: string
  mtimeMs: number
  ok: boolean
  error?: string
  counts?: { groups: number; lists: number; todos: number }
}

const dir = ref('')
const items = ref<BackupItem[]>([])
const loaded = ref(false)
const rootEl = ref<HTMLElement | null>(null)
let restoring = false

function closeBackups(): void {
  ui.backupOpen = false
}

/** 备份列表是只读的:初始焦点给关闭按钮,不会误触「恢复」 */
function focusClose(): HTMLElement | null {
  return rootEl.value?.querySelector<HTMLElement>('[data-testid="backup-close"]') ?? null
}

const { isTopmost } = useDialogFocus(rootEl, closeBackups, focusClose)

onMounted(async () => {
  const res = (await window.todoAPI.invoke(CH.backupsList)) as {
    ok: boolean
    dir?: string
    items?: BackupItem[]
  }
  dir.value = res.dir ?? ''
  items.value = res.items ?? []
  loaded.value = true
})

function summary(it: BackupItem): string {
  if (!it.ok || !it.counts) return '无法解析'
  return `${it.counts.todos} 条任务 / ${it.counts.lists} 清单 / ${it.counts.groups} 分组`
}

/** 恢复=导入:确认框与合并路径都由导入管线提供,这里只负责把文件路径递过去 */
function restore(it: BackupItem): void {
  if (!it.ok || restoring) return
  restoring = true
  ui.backupOpen = false
  void importFromDialog(it.path)
}

function openDir(): void {
  void window.todoAPI.invoke(CH.storeOpenDir, 'backups')
}
</script>

<template>
  <Teleport to="body">
    <!-- z-index 105:低于 ConfirmDialog 的 110,「替换/合并」确认框不会被压在下面 -->
    <div class="overlay" data-testid="backup-dialog" :inert="isTopmost ? undefined : true" @click.self="ui.backupOpen = false">
      <div
        ref="rootEl"
        class="dialog"
        role="dialog"
        aria-labelledby="backup-dialog-title"
        :aria-modal="isTopmost ? 'true' : undefined"
        style="--dialog-width: 640px"
      >
        <h2 id="backup-dialog-title">从备份恢复</h2>
        <p class="hint">
          备份目录：{{ dir || '（未知）' }}<br />
          每天首次改动自动写一份，保留最新 10 份。恢复 = 导入该文件：会先让你选「替换 / 合并」，
          替换后当前数据可在底部提示里点「撤销」回退。
        </p>

        <!-- 备份行是唯一滚动区;备份多到装不下时 footer 仍然留在视野里 -->
        <div class="dialog-body">
          <div class="list">
            <p v-if="loaded && items.length === 0" class="empty" data-testid="backup-empty">
              还没有备份：应用每天首次改动时写一份。
            </p>
            <div v-for="it in items" :key="it.path" class="item" :data-backup="it.name">
              <span class="when">{{ stampLabel(it.mtimeMs) }}</span>
              <span class="sum" :class="{ bad: !it.ok }">{{ summary(it) }}</span>
              <span class="spacer" />
              <button
                class="btn"
                data-testid="backup-restore"
                :disabled="!it.ok"
                :title="it.ok ? '导入这份备份' : `无法解析：${it.error ?? ''}`"
                @click="restore(it)"
              >
                {{ it.ok ? '恢复' : '无法解析' }}
              </button>
            </div>
          </div>
        </div>

        <div class="foot">
          <button class="btn" data-testid="backup-open-dir" @click="openDir">打开备份目录</button>
          <span class="spacer" />
          <button class="btn" data-testid="backup-close" @click="ui.backupOpen = false">关闭</button>
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

.hint {
  margin: 0 0 12px;
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.6;
  word-break: break-all;
}

.list {
  border: 1px solid var(--line);
  border-radius: var(--radius-control);
}

.empty {
  margin: 0;
  padding: 24px 12px;
  text-align: center;
  color: var(--text-mute);
  font-size: 12px;
}

.item {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 34px;
  padding: 4px 10px;
  border-bottom: 1px solid var(--line);
  font-size: 12px;
}

.item:last-child {
  border-bottom: 0;
}

.when {
  flex: 0 0 112px;
}

.sum {
  color: var(--text-dim);
}

.sum.bad {
  color: var(--danger);
}

.spacer {
  flex: 1 1 auto;
}
</style>
