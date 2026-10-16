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
let restoring = false

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
    <div class="overlay" data-testid="backup-dialog" @click.self="ui.backupOpen = false">
      <div class="dialog">
        <h2>从备份恢复</h2>
        <p class="hint">
          备份目录：{{ dir || '（未知）' }}<br />
          每天首次改动自动写一份，保留最新 10 份。恢复 = 导入该文件：会先让你选「替换 / 合并」，
          替换后当前数据可在底部提示里点「撤销」回退。
        </p>

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
  position: fixed;
  inset: 0;
  background: rgb(0 0 0 / 35%);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 105;
}

.dialog {
  width: 520px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  padding: 18px 20px 14px;
  border-radius: 10px;
  background: var(--card);
  border: 1px solid var(--line);
  box-shadow: 0 12px 40px rgb(0 0 0 / 25%);
}

h2 {
  margin: 0 0 10px;
  font-size: 15px;
}

.hint {
  margin: 0 0 12px;
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.6;
  word-break: break-all;
}

.list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  border: 1px solid var(--line);
  border-radius: 8px;
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
  padding: 7px 10px;
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

.foot {
  display: flex;
  align-items: center;
  margin-top: 12px;
}

.btn {
  padding: 5px 12px;
  border-radius: 6px;
  border: 1px solid var(--field-line);
  background: var(--card);
  color: var(--text);
  font-size: 12px;
}

.btn:hover:not(:disabled) {
  background: var(--hover);
}

.btn:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
