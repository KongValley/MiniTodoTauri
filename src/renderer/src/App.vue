<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import { CH } from '@shared/api'
import Sidebar from './components/Sidebar.vue'
import TopBar from './components/TopBar.vue'
import TaskTools from './components/TaskTools.vue'
import StatusBar from './components/StatusBar.vue'
import BoardView from './components/BoardView.vue'
import ListView from './components/ListView.vue'
import TaskDialog from './components/TaskDialog.vue'
import GroupListDialog from './components/GroupListDialog.vue'
import SettingsDialog from './components/SettingsDialog.vue'
import HelpDialog from './components/HelpDialog.vue'
import BackupDialog from './components/BackupDialog.vue'
import ExportDialog from './components/ExportDialog.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
import CardMenu from './components/CardMenu.vue'
import Toast from './components/Toast.vue'
import { init, state, commit, captureUndo, undoLast } from './store/data'
import { startClock } from './store/index'
import { applyTheme, refreshSettings } from './store/settings'
import { askConfirm, toast, ui } from './store/ui'
import { mergeStore } from '@shared/store-ops'
import type { Store } from '@shared/types'
import { useGlobalKeymap } from './lib/keymap'
import { hasModal } from './lib/dialog-focus'

useGlobalKeymap()

let offTheme: (() => void) | undefined
let offBoard: (() => void) | undefined
let offDialog: (() => void) | undefined

onMounted(async () => {
  // 分钟心跳:让跨零点后按 today() 算出来的计数失效重建
  startClock()
  // 监听必须在 init() 之前注册:init 抛错也不会让托盘/菜单触发的 IPC 事件永久失效
  offTheme = window.todoAPI.on(CH.themeSet, (...args: unknown[]) => {
    const theme = args[0] as 'system' | 'light' | 'dark'
    void refreshSettings().then(() => applyTheme(theme))
  })
  offBoard = window.todoAPI.on(CH.uiSetBoard, (...args: unknown[]) => {
    ui.board = args[0] !== false
  })
  offDialog = window.todoAPI.on(CH.uiOpenDialog, (...args: unknown[]) => {
    const kind = args[0] as string
    if (kind === 'settings') ui.settingsOpen = true
    else if (kind === 'help') ui.helpOpen = true
    else if (kind === 'backup') ui.backupOpen = true
    else if (kind === 'export') ui.exportOpen = true
    else if (kind === 'warning') toast(String(args[1] ?? '数据文件异常'))
    else if (kind === 'imported') {
      const c = args[1] as { groups: number; lists: number; todos: number } | undefined
      toast(`已导入 ${c?.groups ?? 0} 个分组 / ${c?.lists ?? 0} 个清单 / ${c?.todos ?? 0} 条任务`)
      void init()
    } else if (kind === 'import-choice') {
      const c = args[1] as { store: Store; counts: { groups: number; lists: number; todos: number } }
      askConfirm(
        '导入数据',
        `文件包含 ${c.counts.groups} 个分组 / ${c.counts.lists} 个清单 / ${c.counts.todos} 条任务。\n「替换」会丢弃当前全部数据（当天已有一份自动备份，替换后还能点底部「撤销」回退）；「合并」保留现有任务，同 id 的条目跳过。`,
        () => {
          captureUndo()
          void commit(c.store).then(() => toast('已替换', { label: '撤销', run: () => void undoLast() }))
        },
        {
          label: '合并进当前数据',
          onOk: () => {
            const { store, skipped } = mergeStore(state.store, c.store)
            const s = skipped.groups + skipped.lists + skipped.todos
            captureUndo()
            void commit(store).then(() =>
              toast(s > 0 ? `已合并，跳过 ${s} 条重复` : '已合并', { label: '撤销', run: () => void undoLast() })
            )
          }
        }
      )
    } else if (kind === 'exported') toast(`已导出到 ${String(args[1] ?? '')}`)
  })

  await init()
  applyTheme(state.settings?.theme ?? 'system')
})

onBeforeUnmount(() => {
  offTheme?.()
  offBoard?.()
  offDialog?.()
})
</script>

<template>
  <div class="shell">
    <!-- 弹窗开着时只有这一块 inert:Tab 不能走到遮罩后面,Teleport 出来的弹窗与 Toast 不受影响 -->
    <div class="workspace" :inert="hasModal ? true : undefined">
      <Sidebar />
      <div class="main">
        <TopBar class="row-top" />
        <TaskTools class="row-tools" />
        <div class="body row-body" data-testid="body">
          <BoardView v-if="ui.board" />
          <ListView v-else />
        </div>
        <StatusBar class="row-status" />
      </div>
    </div>

    <GroupListDialog v-if="ui.meta" :key="ui.meta.seq" />
    <TaskDialog v-if="ui.dialog" :key="ui.dialog.seq" />
    <SettingsDialog v-if="ui.settingsOpen" />
    <HelpDialog v-if="ui.helpOpen" />
    <BackupDialog v-if="ui.backupOpen" />
    <ExportDialog v-if="ui.exportOpen" />
    <ConfirmDialog v-if="ui.confirm" />
    <CardMenu v-if="ui.cardMenu" />
    <Toast v-if="ui.toast" :text="ui.toast.text" :action="ui.toast.action" />
  </div>
</template>

<style scoped>
.shell {
  height: 100%;
  overflow: hidden;
}

.workspace {
  display: grid;
  grid-template-columns: 216px minmax(0, 1fr);
  height: 100%;
}

/* 窄窗口(最小 900px)侧栏收窄,给画布让出宽度 */
@media (max-width: 1100px) {
  .workspace {
    grid-template-columns: 192px minmax(0, 1fr);
  }
}

.main {
  display: grid;
  /* TopBar / 快捷录入工具区 / 滚动视图区 / 状态栏 */
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  min-width: 0;
  /* 作为 .shell 的 grid item,min-height 默认 auto 会被内容撑高,
     导致内部滚动容器(看板列/列表)拿不到可视高度,虚拟滚动无从计算窗口 */
  min-height: 0;
  height: 100%;
  overflow: hidden;
}

/* 行号写死:工具区在「已完成/已放弃/回收站」会整体消失(v-if),
   靠自动排布的话后面两块会被上提 —— 视图区拿不到确定高度(虚拟滚动失效),
   状态栏还会被挤到 overflow:hidden 的 main 之外 */
.main > .row-top {
  grid-row: 1;
}

.main > .row-tools {
  grid-row: 2;
}

.main > .row-body {
  grid-row: 3;
}

.main > .row-status {
  grid-row: 4;
}

.body {
  min-height: 0;
  overflow: hidden;
}
</style>
