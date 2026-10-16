/**
 * 键盘事件的纯判定。抽成独立模块:keymap ↔ dialog-focus ↔ 各组件都要用,
 * 放在任一方都会引出循环依赖(或把组件耦合进快捷键表)。
 */

/** 焦点在输入类控件里:全局快捷键必须让位给原生输入行为 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable
}

/**
 * 中文输入法选词中的回车/Esc。Vue 的 withKeys 只比对 key,不带这个判断,
 * 选词那一下回车会被当成「保存」——而此时 v-model 还没拿到整段中文。
 */
export function isComposingEvent(e: KeyboardEvent): boolean {
  return e.isComposing || e.keyCode === 229
}
