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
</script>

<template>
  <footer class="statusbar" data-testid="statusbar">
    <span class="path" :title="state.path">{{ state.path }}</span>
    <span v-if="hitCount !== null" class="hint">搜索命中 {{ hitCount }} 条</span>
    <span class="spacer" />
    <span v-if="state.saveFailed" class="save-err" data-testid="save-failed">保存失败，数据未写入磁盘</span>
    <span class="today">今天待办 {{ todayCount }} 项</span>
    <button v-if="settingsState.value.notifyEnabled" class="snooze" data-testid="snooze" @click="onSnooze">
      稍后提醒
    </button>
    <span class="hint">N 新建　Enter/F2 打开　Del 删除　B 切换视图　Ctrl+F 搜索　F5 刷新</span>
  </footer>
</template>

<style scoped>
.statusbar {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 5px 14px;
  border-top: 1px solid var(--line);
  background: var(--status);
  color: var(--text-dim);
  font-size: 12px;
}

.path {
  max-width: 380px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.spacer {
  flex: 1 1 auto;
}

.today {
  color: var(--text);
}

.save-err {
  color: var(--danger);
  font-weight: 600;
}

.snooze {
  padding: 2px 8px;
  border: 1px solid var(--field-line);
  border-radius: 5px;
  background: var(--card);
  color: var(--text-dim);
  font-size: 12px;
}

.snooze:hover {
  background: var(--hover);
  color: var(--text);
}

.hint {
  color: var(--text-mute);
}
</style>
