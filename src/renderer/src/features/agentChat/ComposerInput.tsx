import { acceptsAssistKey, historyStep, type HistoryCursor } from './composerAssist'
import { isNewlineKey } from './sendKey'
import { isolateHistory } from '@codemirror/commands'
import { flushSync } from 'react-dom'
import { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from 'react'
import { Compartment, EditorState, Prec, StateEffect, Transaction } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, placeholder, type DecorationSet } from '@codemirror/view'
import { minimalSetup } from 'codemirror'
import { REFERENCE_GLYPHS, referenceLabel, referenceRanges, type ComposerReference } from './composerReferences'
import { useReferenceHover } from './ReferencePreview'
import { t as tNow, useT } from '../../i18n.ts'

/** The composer boundary remains plain text plus text offsets, never rendered labels/HTML. */
export type ComposerInputElement = HTMLDivElement & Pick<HTMLTextAreaElement, 'value' | 'selectionStart' | 'selectionEnd' | 'setSelectionRange'> & { insertVoiceText(text: string): void }

/** 把键盘焦点放进输入框、光标置末尾（插件 ui/message 注入后聚焦过去用）。没挂载就抛，由登记表兜成 false。 */
export function focusComposerEnd(el: ComposerInputElement | null): void {
  if (!el) throw new Error('composer not mounted')
  el.focus()
  const end = el.value.length
  el.setSelectionRange(end, end)
}
interface Props {
  value: string
  onChange: (text: string) => void
  references: readonly ComposerReference[]
  className: string
  placeholder?: string
  suggestion?: string
  history?: readonly string[]
  assistScope?: string
  disabled?: boolean
  autoFocus?: boolean
  rows?: number
  onFocus?: () => void
  onBlur?: () => void
  onClick?: () => void
  onSelect?: () => void
  onKeyUp?: () => void
  onKeyDown?: (event: KeyboardEvent) => void
  onPaste?: (event: ClipboardEvent) => void
  'aria-expanded'?: boolean
  'aria-controls'?: string
  'aria-activedescendant'?: string
  'aria-autocomplete'?: 'list'
}
class ReferenceWidget extends WidgetType {
  constructor(readonly reference: ComposerReference) { super() }
  eq(other: ReferenceWidget): boolean { return JSON.stringify(this.reference) === JSON.stringify(other.reference) }
  toDOM(): HTMLElement {
    const r = this.reference, chip = document.createElement('span')
    chip.className = 'ac-reference-chip'
    chip.dataset.kind = r.kind; chip.dataset.referenceId = r.id
    chip.setAttribute('aria-label', tNow('chat.input.refAria', { kind: referenceLabel(r.kind), label: r.label }))
    chip.tabIndex = 0
    const icon = document.createElement('span'), label = document.createElement('span')
    icon.className = 'ac-reference-glyph'; icon.textContent = REFERENCE_GLYPHS[r.kind]; icon.setAttribute('aria-hidden', 'true')
    label.className = 'ac-reference-label'; label.textContent = r.label
    chip.append(icon, label)
    return chip
  }
  ignoreEvent(): boolean { return false }
}
const refreshReferences = StateEffect.define<void>()

export const ComposerInput = forwardRef<ComposerInputElement, Props>(function ComposerInput(props, ref) {
  const t = useT()
  const host = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView>()
  const editable = useRef(new Compartment())
  const editing = useRef(new Compartment())
  const hint = useRef(new Compartment())
  const recall = useRef<HistoryCursor | null>(null)
  const navigating = useRef(false)
  const latest = useRef(props); latest.current = props
  const hover = useReferenceHover()
  const hoverRef = useRef(hover); hoverRef.current = hover
  const syncing = useRef(false)
  const hintExtension = (): ReturnType<typeof placeholder> => placeholder(() => {
    const span = document.createElement('span')
    const suggestion = latest.current.suggestion
    if (!suggestion || latest.current.disabled || latest.current['aria-expanded']) { span.textContent = latest.current.placeholder ?? ''; return span }
    span.className = 'ac-composer-ghost'
    const copy = document.createElement('span'), key = document.createElement('kbd')
    copy.textContent = suggestion; key.textContent = t('chat.input.tabComplete')
    span.append(copy, key)
    return span
  })
  useLayoutEffect(() => { recall.current = null }, [props.assistScope])
  useLayoutEffect(() => {
    const build = (view: EditorView): DecorationSet => Decoration.set(referenceRanges(view.state.doc.toString(), latest.current.references).map(r => Decoration.replace({ widget: new ReferenceWidget(r.reference) }).range(r.from, r.to)), true)
    const widgets = ViewPlugin.fromClass(class {
      decorations: DecorationSet
      constructor(view: EditorView) { this.decorations = build(view) }
      update(update: import('@codemirror/view').ViewUpdate): void {
        if (update.docChanged || update.transactions.some(t => t.effects.some(e => e.is(refreshReferences)))) this.decorations = build(update.view)
      }
    }, { decorations: v => v.decorations, provide: plugin => EditorView.atomicRanges.of(view => view.plugin(plugin)?.decorations ?? Decoration.none) })
    const showReference = (target: EventTarget | null): void => {
      const chip = target instanceof HTMLElement ? target.closest<HTMLElement>('[data-reference-id]') : null
      const reference = latest.current.references.find(r => r.id === chip?.dataset.referenceId)
      if (chip && reference) hoverRef.current.show(reference, chip)
    }
    const view = new EditorView({ parent: host.current!, state: EditorState.create({ doc: props.value, extensions: [
      editing.current.of(minimalSetup), EditorView.lineWrapping, widgets, hint.current.of(hintExtension()),
      editable.current.of([EditorState.readOnly.of(!!props.disabled), EditorView.editable.of(!props.disabled)]),
      EditorView.theme({ '&.cm-focused': { outline: 'none' }, '.cm-scroller': { fontFamily: 'inherit', overflow: 'auto', maxHeight: '160px' }, '.cm-content': { fontFamily: 'inherit' }, '.cm-line': { padding: '0' }, '.cm-placeholder': { color: 'var(--fg-dim)' } }),
      Prec.highest(EditorView.domEventHandlers({
        keydown(event) {
          if (event.target instanceof HTMLElement && event.target.closest('[data-reference-id]')) {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); showReference(event.target); return true }
          }
          flushSync(() => latest.current.onKeyDown?.(event))
          if (event.defaultPrevented) return true
          // Ctrl / Shift / Alt + Enter = 换行（裸 Enter 由调用方当发送处理，见 sendKey.ts）。
          // 自己插，不靠默认行为：mac 上 Ctrl+Enter 默认什么都不做，Mod-Enter 在 CodeMirror 里是「插空行」
          if (isNewlineKey({ key: event.key, ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey, altKey: event.altKey, isComposing: event.isComposing || view.composing, keyCode: event.keyCode }) && !view.state.readOnly) {
            event.preventDefault()
            view.dispatch(view.state.replaceSelection('\n'), { scrollIntoView: true, userEvent: 'input.type' })
            return true
          }
          const text = view.state.doc.toString(), selection = view.state.selection.main
          if (!acceptsAssistKey({key:event.key,keyCode:event.keyCode,isComposing:event.isComposing || view.composing,ctrlKey:event.ctrlKey,altKey:event.altKey,metaKey:event.metaKey,shiftKey:event.shiftKey,text,from:selection.from,to:selection.to,menuOpen:latest.current['aria-expanded'],disabled:view.state.readOnly})) return false
          const suggestion = latest.current.suggestion
          const step = event.key === 'Tab'
            ? (!text && suggestion ? {text:suggestion,state:null} : null)
            : historyStep(recall.current,event.key,text,latest.current.history ?? [])
          if (!step) return false
          event.preventDefault(); event.stopPropagation()
          navigating.current = true
          try {
            view.dispatch({changes:{from:0,to:view.state.doc.length,insert:step.text},selection:{anchor:step.text.length},scrollIntoView:true,annotations:[Transaction.userEvent.of('input.complete'),isolateHistory.of('full')]})
            recall.current = step.state
          } finally { navigating.current = false }
          return true
        },
        paste(event) { latest.current.onPaste?.(event); return event.defaultPrevented },
        focus() { latest.current.onFocus?.() }, blur() { recall.current = null; latest.current.onBlur?.(); hoverRef.current.close() },
        click() { recall.current = null; latest.current.onClick?.() }, keyup() { latest.current.onKeyUp?.() },
        mouseover(event) { showReference(event.target) }, mouseout() { hoverRef.current.close() },
        focusin(event) { showReference(event.target) }
      })),
      EditorView.updateListener.of(update => {
        if (!navigating.current && (update.docChanged || update.selectionSet)) recall.current = null
        if (update.docChanged && !update.transactions.filter(t => t.docChanged).every(t => t.isUserEvent('input.voice'))) {
          update.view.contentDOM.dispatchEvent(new Event('voice:document-edit', {bubbles:true}))
        }
        if (update.docChanged && !syncing.current) {
          const value = update.state.doc.toString()
          // Commit controlled React state before the next key event, but outside
          // CodeMirror's update (React layout effects may dispatch back to it).
          queueMicrotask(() => {
            if (viewRef.current === update.view && update.view.state.doc.toString() === value) flushSync(() => latest.current.onChange(value))
          })
        }
        if (update.selectionSet) latest.current.onSelect?.()
      })
    ] }) })
    viewRef.current = view
    const input = view.contentDOM as ComposerInputElement
    input.classList.add(props.className)
    input.dataset.composerInput = 'true'
    // A small textarea-compatible adapter keeps focus/caret ownership at the existing callers.
    Object.defineProperties(input, {
      insertVoiceText: { configurable: true, value: (text: string) => {
        if (view.state.readOnly) return
        const {from, to} = view.state.selection.main
        view.dispatch({changes:{from,to,insert:text},selection:{anchor:from+text.length},annotations:[Transaction.userEvent.of('input.voice'),isolateHistory.of('full')]})
      } },
      value: { configurable: true, get: () => view.state.doc.toString(), set: (value: string) => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value }, selection: { anchor: value.length }, annotations: Transaction.userEvent.of('input') }) },
      selectionStart: { configurable: true, get: () => view.state.selection.main.from },
      selectionEnd: { configurable: true, get: () => view.state.selection.main.to },
      setSelectionRange: { configurable: true, value: (start: number, end: number) => view.dispatch({ selection: { anchor: Math.max(0, Math.min(start, view.state.doc.length)), head: Math.max(0, Math.min(end, view.state.doc.length)) }, scrollIntoView: true }) }
    })
    if (props.autoFocus) view.focus()
    return () => { view.destroy(); viewRef.current = undefined }
  }, [])
  useImperativeHandle(ref, () => viewRef.current!.contentDOM as ComposerInputElement, [])
  useLayoutEffect(() => {
    const view = viewRef.current
    if (!view) return
    syncing.current = true
    try {
      if (props.value !== view.state.doc.toString()) {
        // Submission/local actions clear the document externally. Do not let undo
        // resurrect references whose attachment payload has already been consumed.
        // Normal user deletion already matches props.value, so its history survives.
        if (!props.value) {
          view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: '' }, effects: editing.current.reconfigure([]), annotations: Transaction.addToHistory.of(false) })
          view.dispatch({ effects: editing.current.reconfigure(minimalSetup) })
        }
        else view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: props.value }, selection: { anchor: Math.min(view.state.selection.main.head, props.value.length) }, annotations: Transaction.userEvent.of('input.complete') })
      }
      view.dispatch({ effects: [refreshReferences.of(), hint.current.reconfigure(hintExtension()), editable.current.reconfigure([EditorState.readOnly.of(!!props.disabled), EditorView.editable.of(!props.disabled)])] })
      for (const name of ['aria-expanded', 'aria-controls', 'aria-activedescendant', 'aria-autocomplete'] as const) {
        const value = props[name]
        if (value === undefined) view.contentDOM.removeAttribute(name)
        else view.contentDOM.setAttribute(name, String(value))
      }
      view.contentDOM.contentEditable = String(!props.disabled)
      view.contentDOM.setAttribute('aria-disabled', String(!!props.disabled))
      view.contentDOM.setAttribute('aria-description', !props.value && props.suggestion ? t('chat.input.suggestionAria', { text: props.suggestion }) : props.history?.length ? t('chat.input.historyAria') : '')
    } finally { syncing.current = false }
  }, [t, props.value, props.references, props.disabled, props.placeholder, props.suggestion, !!props.history?.length, props['aria-expanded'], props['aria-controls'], props['aria-activedescendant']])
  return <div className="ac-rich-input" ref={host} onKeyDownCapture={event => {
    // Let the browser confirm IME text without running the editor's Enter keymap.
    if (event.nativeEvent.isComposing || event.keyCode === 229) event.stopPropagation()
  }}>{hover.preview}{!!props.history?.length && <div className={`ac-composer-recall-hint${props.className === 'ac-input' ? ' startup' : ''}`} data-tip={t('chat.input.historyTip')}>{t('chat.input.historyHint')} <span>{t('chat.input.historyBack')}</span></div>}</div>
})
