<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { today } from '@shared/dates'
import { addTodo, newId, removeTodos, setStatus, updateTodo } from '@shared/store-ops'
import {
  ACTIVE,
  DONE,
  DROPPED,
  INBOX_NAME,
  PRIO_NAME,
  REPEAT_NAME,
  STATUS_NAME,
  type Prio,
  type RepeatKind,
  type Status,
  type Subtask
} from '@shared/types'
import { mutate, state } from '../store/data'
import { closeDialog, requestNew, ui, type TaskDialogState } from '../store/ui'
import { isComposingEvent } from '../lib/input-events'
import { useDialogFocus } from '../lib/dialog-focus'
import Icon from './Icon.vue'

const dialog = ui.dialog as TaskDialogState

const existing = dialog.mode === 'edit' ? state.store.todos.find((t) => t.id === dialog.id) : undefined

const form = reactive({
  title: existing?.title ?? dialog.presetTitle ?? '',
  note: existing?.note ?? '',
  // 预设日期为空字符串与「没有预设」同义:两者都不勾「不排期」是没有道理的,
  // 收集箱/未排期语境下新建本来就该是未排期
  noDate: existing ? existing.date === '' : dialog.presetDate === undefined || dialog.presetDate === '',
  date: existing?.date && existing.date !== '' ? existing.date : dialog.presetDate || today(),
  lid: existing?.lid ?? dialog.presetList ?? '',
  prio: (existing?.prio ?? 2) as Prio,
  status: (existing?.status ?? ACTIVE) as Status,
  repeat: (existing?.repeat.kind ?? 'none') as RepeatKind,
  subtasks: (existing?.subtasks ?? []).map((s) => ({ ...s })) as Subtask[]
})

const titleInput = ref<HTMLInputElement | null>(null)
const newSub = ref('')

const rootEl = ref<HTMLElement | null>(null)

/**
 * 初次聚焦标题,光标放末尾 —— 「详细编辑」转交过来的草稿要能直接续写,
 * 而不是从头覆盖。焦点由 dialog-focus 统一在挂载后给到最上面的弹窗。
 */
function focusTitle(): HTMLElement | null {
  const el = titleInput.value
  if (el) {
    el.focus()
    const end = el.value.length
    el.setSelectionRange(end, end)
  }
  return el
}

const { isTopmost } = useDialogFocus(rootEl, closeDialog, focusTitle)

const canSave = computed(() => form.title.trim() !== '')
const isEdit = computed(() => dialog.mode === 'edit')

const listsByGroup = computed(() =>
  state.store.groups.map((g) => ({
    group: g,
    lists: state.store.lists.filter((l) => l.gid === g.id).sort((a, b) => a.order - b.order)
  }))
)

const statusOptions = computed(() => [ACTIVE, DONE, DROPPED] as Status[])

/** 选词中的回车不上屏的是半成品标题,不能当保存 */
function onEnterSave(e: KeyboardEvent): void {
  if (isComposingEvent(e)) return
  save()
}

function onEnterAddSub(e: KeyboardEvent): void {
  if (isComposingEvent(e)) return
  addSub()
}

function save(): void {
  if (!canSave.value) return
  const patch = {
    title: form.title.trim(),
    note: form.note.trim(),
    date: form.noDate ? '' : form.date,
    lid: form.lid,
    prio: form.prio,
    // 带过 anchorDay:不带上就把每月重复的原始日号抹成默认(见 RepeatRule.anchorDay)
    repeat: { ...existing?.repeat, kind: form.repeat },
    subtasks: form.subtasks.filter((s) => s.title.trim() !== '')
  }

  if (isEdit.value && dialog.id) {
    const id = dialog.id
    const status = form.status
    void mutate((s) => setStatus(updateTodo(s, id, patch), id, status))
  } else {
    void mutate((s) => addTodo(s, patch))
  }
  closeDialog()
}

/**
 * 保存并新建:沿用本次填的日期与清单,连着录多条不用每轮重选。
 * save() 内部已 closeDialog,requestNew 的 seq 自增会让弹窗按新预设重挂。
 */
function saveAndNew(): void {
  if (!canSave.value) return
  const preset = { date: form.noDate ? '' : form.date, list: form.lid }
  save()
  requestNew(preset)
}

function removeThis(): void {
  if (!dialog.id) return
  const id = dialog.id
  void mutate((s) => removeTodos(s, [id], false))
  closeDialog()
}

function addSub(): void {
  const t = newSub.value.trim()
  if (t === '') return
  form.subtasks.push({ id: newId(), title: t, done: false })
  newSub.value = ''
}

function removeSub(index: number): void {
  form.subtasks.splice(index, 1)
}
</script>

<template>
  <Teleport to="body">
    <div class="overlay" data-testid="task-dialog" :inert="isTopmost ? undefined : true" @click.self="closeDialog">
      <div
        ref="rootEl"
        class="dialog"
        role="dialog"
        aria-labelledby="task-dialog-title"
        :aria-modal="isTopmost ? 'true' : undefined"
      >
        <h2 id="task-dialog-title" class="dt">{{ isEdit ? '编辑任务' : '新建任务' }}</h2>

        <!-- 表单区独立滚动,footer 永远留在可视区内(长备注/多子任务时不用滚到底找按钮) -->
        <div class="form-body">
          <label class="field">
          <span class="lbl">任务标题</span>
          <input ref="titleInput" v-model="form.title" data-testid="dlg-title" placeholder="要做什么？" @keydown.enter="onEnterSave" />
        </label>

        <label class="field">
          <span class="lbl">备注</span>
          <textarea v-model="form.note" data-testid="dlg-note" rows="2" />
        </label>

        <div class="row2">
          <label class="inline">
            <input v-model="form.noDate" type="checkbox" data-testid="dlg-nodate" />
            <span>不排期</span>
          </label>
          <input v-model="form.date" type="date" data-testid="dlg-date" :disabled="form.noDate" />
        </div>

        <div class="row2">
          <label class="field">
            <span class="lbl">清单</span>
            <select v-model="form.lid" data-testid="dlg-list">
              <option value="">{{ INBOX_NAME }}</option>
              <optgroup v-for="entry in listsByGroup" :key="entry.group.id" :label="entry.group.name">
                <option v-for="l in entry.lists" :key="l.id" :value="l.id">{{ l.name }}</option>
              </optgroup>
            </select>
          </label>

          <label class="field">
            <span class="lbl">优先级</span>
            <select v-model.number="form.prio" data-testid="dlg-prio">
              <option :value="1">{{ PRIO_NAME[1] }}</option>
              <option :value="2">{{ PRIO_NAME[2] }}</option>
              <option :value="3">{{ PRIO_NAME[3] }}</option>
            </select>
          </label>
        </div>

        <div class="row2">
          <label v-if="isEdit" class="field">
            <span class="lbl">状态</span>
            <select v-model.number="form.status" data-testid="dlg-status">
              <option v-for="s in statusOptions" :key="s" :value="s">{{ STATUS_NAME[s] }}</option>
            </select>
          </label>

          <label class="field">
            <span class="lbl">重复</span>
            <select v-model="form.repeat" data-testid="dlg-repeat">
              <option v-for="(name, kind) in REPEAT_NAME" :key="kind" :value="kind">{{ name }}</option>
            </select>
          </label>
        </div>

        <div class="field">
          <span class="lbl">子任务</span>
          <div class="subs" data-testid="dlg-subs">
            <div v-for="(s, i) in form.subtasks" :key="s.id" class="sub-row">
              <input v-model="s.done" type="checkbox" />
              <input v-model="s.title" class="sub-title" />
              <button class="x" @click="removeSub(i)"><Icon name="close" :size="12" /></button>
            </div>
            <div class="sub-row">
              <span class="plus"><Icon name="plus" :size="13" /></span>
              <input v-model="newSub" class="sub-title" placeholder="添加子任务，回车确认" @keydown.enter.prevent="onEnterAddSub" />
            </div>
          </div>
        </div>
        </div>

        <div class="foot">
          <button v-if="isEdit" class="btn danger" data-testid="dlg-delete" @click="removeThis">移入回收站</button>
          <span class="spacer" />
          <button class="btn" data-testid="dlg-cancel" @click="closeDialog">取消</button>
          <button v-if="!isEdit" class="btn" data-testid="dlg-save-new" :disabled="!canSave" @click="saveAndNew">
            保存并新建
          </button>
          <button class="btn primary" data-testid="dlg-save" :disabled="!canSave" @click="save">保存</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: var(--overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.dialog {
  width: 520px;
  max-width: calc(100vw - 48px);
  max-height: calc(100vh - 48px);
  display: flex;
  flex-direction: column;
  padding: 24px;
  border-radius: var(--radius-dialog);
  background: var(--card);
  border: 1px solid var(--line);
  box-shadow: var(--shadow-popover);
}

/* 只有表单区滚动:标题与按钮永远在看得见的地方 */
.form-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding-right: 4px;
}

.dt {
  margin: 0 0 16px;
  font-size: 18px;
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

.field input,
.field select,
.field textarea {
  width: 100%;
  resize: vertical;
}

.row2 {
  display: flex;
  gap: 12px;
  align-items: flex-end;
  margin-bottom: 12px;
}

.row2 .field {
  flex: 1 1 0;
  margin-bottom: 0;
}

.inline {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-bottom: 6px;
  white-space: nowrap;
}

.subs {
  border: 1px solid var(--field-line);
  border-radius: var(--radius-control);
  padding: 6px;
  background: var(--field);
}

.sub-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.sub-title {
  flex: 1 1 auto;
  border: none;
  background: none;
  padding: 3px 4px;
}

.sub-title:focus {
  border: none;
}

.plus {
  width: 15px;
  text-align: center;
  color: var(--text-mute);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.x {
  color: var(--text-mute);
  padding: 0 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.x:hover {
  color: var(--danger);
}

.foot {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--line);
  flex: 0 0 auto;
}

.spacer {
  flex: 1 1 auto;
}

.btn {
  min-height: 36px;
  padding: 0 16px;
  border-radius: var(--radius-control);
  border: 1px solid var(--field-line);
  background: var(--card);
}

.btn:hover:not(:disabled) {
  background: var(--hover);
}

.btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.btn.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--on-accent);
}

.btn.danger {
  color: var(--danger);
  border-color: var(--danger);
}

.btn.primary:hover:not(:disabled) {
  box-shadow: var(--shadow-card);
}

.btn.danger {
  color: var(--danger);
}

.btn.danger:hover {
  border-color: var(--danger);
}
</style>
