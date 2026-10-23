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
        style="--dialog-width: 720px"
      >
        <h2 id="task-dialog-title" class="dt">{{ isEdit ? '编辑任务' : '新建任务' }}</h2>

        <!-- 标题固定在滚动区外:长备注时不必滚到底才看得到自己在编哪条任务 -->
        <div class="head-field">
          <label class="vh" for="dlg-title-input">任务标题</label>
          <input
            id="dlg-title-input"
            ref="titleInput"
            v-model="form.title"
            class="title-input"
            data-testid="dlg-title"
            placeholder="要做什么？"
            @keydown.enter="onEnterSave"
          />
        </div>

        <!-- 只有这一块滚动:备注与子任务在左,属性在右,视口不够时上下排 -->
        <div class="dialog-body">
          <div class="cols">
            <div class="col-main">
              <label class="field">
                <span class="lbl">备注</span>
                <textarea v-model="form.note" data-testid="dlg-note" rows="3" />
              </label>

              <div class="field">
                <span class="lbl">子任务</span>
                <div class="subs" data-testid="dlg-subs">
                  <div v-for="(s, i) in form.subtasks" :key="s.id" class="sub-row">
                    <input v-model="s.done" type="checkbox" :aria-label="`完成子任务：${s.title}`" />
                    <input
                      v-model="s.title"
                      class="sub-title"
                      :aria-label="`子任务名称：${s.title}`"
                    />
                    <button class="x" :aria-label="`删除子任务：${s.title}`" @click="removeSub(i)">
                      <Icon name="close" :size="12" />
                    </button>
                  </div>
                  <div class="sub-row">
                    <span class="plus"><Icon name="plus" :size="13" /></span>
                    <input
                      v-model="newSub"
                      class="sub-title"
                      placeholder="添加子任务，回车确认"
                      aria-label="添加子任务"
                      @keydown.enter.prevent="onEnterAddSub"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div class="col-side">
              <label class="inline">
                <input v-model="form.noDate" type="checkbox" data-testid="dlg-nodate" />
                <span>不排期</span>
              </label>
              <label class="field">
                <span class="lbl">日期</span>
                <input
                  v-model="form.date"
                  type="date"
                  data-testid="dlg-date"
                  aria-label="任务日期"
                  :disabled="form.noDate"
                />
              </label>

              <label class="field">
                <span class="lbl">清单</span>
                <select v-model="form.lid" data-testid="dlg-list" aria-label="所属清单">
                  <option value="">{{ INBOX_NAME }}</option>
                  <optgroup v-for="entry in listsByGroup" :key="entry.group.id" :label="entry.group.name">
                    <option v-for="l in entry.lists" :key="l.id" :value="l.id">{{ l.name }}</option>
                  </optgroup>
                </select>
              </label>

              <label class="field">
                <span class="lbl">优先级</span>
                <select v-model.number="form.prio" data-testid="dlg-prio" aria-label="优先级">
                  <option :value="1">{{ PRIO_NAME[1] }}</option>
                  <option :value="2">{{ PRIO_NAME[2] }}</option>
                  <option :value="3">{{ PRIO_NAME[3] }}</option>
                </select>
              </label>

              <label class="field">
                <span class="lbl">重复</span>
                <select v-model="form.repeat" data-testid="dlg-repeat" aria-label="重复规则">
                  <option v-for="(name, kind) in REPEAT_NAME" :key="kind" :value="kind">{{ name }}</option>
                </select>
              </label>

              <label v-if="isEdit" class="field">
                <span class="lbl">状态</span>
                <select v-model.number="form.status" data-testid="dlg-status" aria-label="任务状态">
                  <option v-for="s in statusOptions" :key="s" :value="s">{{ STATUS_NAME[s] }}</option>
                </select>
              </label>
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
  z-index: 100;
}

.dt {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

/* 标题固定:长备注时不必滚到底才知道在编哪条 */
.head-field input {
  width: 100%;
  height: 36px;
  font-size: 15px;
}

.cols {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 220px;
  gap: 20px;
}

/* 窄窗口(最小 900px 减去侧栏后更窄)排不下两列,上下堆 */
@media (max-width: 760px) {
  .cols {
    grid-template-columns: minmax(0, 1fr);
    gap: 0;
  }
}

.col-side .field:first-of-type {
  margin-top: 12px;
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
  min-height: 32px;
  resize: vertical;
}

.inline {
  display: flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}

.subs {
  border: 1px solid var(--field-line);
  border-radius: var(--radius-control);
  padding: 4px;
  background: var(--field);
}

.sub-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
}

.sub-title {
  flex: 1 1 auto;
  min-width: 0;
  border: none;
  background: none;
}

.sub-title:focus {
  border: none;
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

.plus {
  width: 16px;
  text-align: center;
  color: var(--text-mute);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.x {
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  border-radius: var(--radius-control);
  color: var(--text-mute);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.x:hover {
  background: var(--hover);
  color: var(--danger);
}
</style>
