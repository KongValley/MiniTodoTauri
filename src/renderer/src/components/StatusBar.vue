<script setup lang="ts">
import { computed } from 'vue'
import { CH } from '@shared/api'
import { state } from '../store/data'
import { index } from '../store/index'
import { settingsState } from '../store/settings'
import { toast, ui } from '../store/ui'

// 两个计数都取自单次扫描的索引,不再各自扫全表
// 「今天待办」= 今天 + 逾期(与「今天」视图同一口径,两个数字不再互相矛盾)
const todayCount = computed(() => index.value.counts['today'] ?? 0)
// 搜索命中数 = 命中搜索词的全部任务(不限视图),与索引的 hits 同义
const hitCount = computed(() => (ui.search ? index.value.hits.length : null))

/** 稍后提醒:交给主进程记到点时刻,到点后穿透「同日不重复」再发一次通知 */
async function onSnooze(): Promise<void> {
  const res = (await window.todoAPI.invoke(CH.appSnooze, 10)) as { ok: boolean; error?: string }
  toast(res.ok ? '已设置：10 分钟后提醒' : `设置失败：${res.error ?? '未知原因'}`)
}

/** 数据目录:完整路径塞不进底栏,收成一个按钮,路径放 title / aria-label */
async function openDataDir(): Promise<void> {
  const res = (await window.todoAPI.invoke(CH.storeOpenDir)) as { ok: boolean; error?: string }
  if (!res.ok) toast(`打开数据目录失败：${res.error ?? '未知原因'}`)
}
</script>

<template>
  <footer class="statusbar" data-testid="statusbar">
    <button class="dir" :title="state.path" :aria-label="`打开数据目录：${state.path}`" @click="openDataDir">
      数据目录
    </button>
    <span v-if="hitCount !== null" class="hint" data-testid="global-hits">全局搜索 {{ hitCount }} 项</span>
    <span class="spacer" />
    <span v-if="state.saveFailed" class="save-err" data-testid="save-failed" role="alert">保存失败，数据未写入磁盘</span>
    <span class="today">今天待办 {{ todayCount }} 项</span>
    <button v-if="settingsState.value.notifyEnabled" class="snooze" data-testid="snooze" @click="onSnooze">
      稍后提醒
    </button>
  </footer>
</template>

<style scoped>
/* 底栏只留「全局搜索计数 / 今天待办 / 稍后提醒 / 保存失败」四件事,
   长串快捷键移进帮助弹窗(快捷键表本来就是它的正式去处) */
.statusbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  min-width: 0;
  padding: 6px 20px;
  border-top: 1px solid var(--line);
  background: var(--status);
  color: var(--text-dim);
  font-size: 12px;
}

.dir {
  flex: 0 1 auto;
  min-width: 0;
  min-height: 26px;
  padding: 0 10px;
  border-radius: var(--radius-control);
  border: 1px solid var(--field-line);
  background: var(--card);
  color: var(--text-dim);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dir:hover {
  background: var(--hover);
  color: var(--text);
}

.spacer {
  flex: 1 1 auto;
  min-width: 8px;
}

.today {
  flex: 0 0 auto;
  color: var(--text);
  white-space: nowrap;
}

/* 保存失败不可被省略号吃掉:宁愿换行也要看全 */
.save-err {
  flex: 0 0 auto;
  color: var(--danger);
  font-weight: 600;
  white-space: nowrap;
}

.hint {
  flex: 0 1 auto;
  white-space: nowrap;
}

.snooze {
  flex: 0 0 auto;
  min-height: 26px;
  padding: 0 10px;
  border: 1px solid var(--field-line);
  border-radius: var(--radius-control);
  background: var(--card);
  color: var(--text-dim);
  font-size: 12px;
}

.snooze:hover {
  background: var(--hover);
  color: var(--text);
}
</style>
