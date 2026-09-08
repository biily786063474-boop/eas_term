import { flushSync } from 'react-dom'
import { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from 'react'
import { Compartment, EditorState, Prec, StateEffect, Transaction } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, placeholder, type DecorationSet } from '@codemirror/view'
import { minimalSetup } from 'codemirror'
import { REFERENCE_GLYPHS, REFERENCE_LABELS, referenceRanges, type ComposerReference } from './composerReferences'
import { useReferenceHover } from './ReferencePreview'

/** The composer boundary remains plain text plus text offsets, never rendered labels/HTML. */
export type ComposerInputElement = HTMLDivElement & Pick<HTMLTextAreaElement, 'value' | 'selectionStart' | 'selectionEnd' | 'setSelectionRange'>
interface Props {
  value: string
  onChange: (text: string) => void
  references: readonly ComposerReference[]
  className: string
  placeholder?: string
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
    chip.setAttribute('aria-label', REFERENCE_LABELS[r.kind] + '：' + r.label)
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
  const host = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView>()
  const editable = useRef(new Compartment())
  const editing = useRef(new Compartment())
  const latest = useRef(props); latest.current = props
  const hover = useReferenceHover()
  const hoverRef = useRef(hover); hoverRef.current = hover
  const syncing = useRef(false)
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
      editing.current.of(minimalSetup), EditorView.lineWrapping, widgets, placeholder(props.placeholder ?? ''),
      editable.current.of([EditorState.readOnly.of(!!props.disabled), EditorView.editable.of(!props.disabled)]),
      EditorView.theme({ '&.cm-focused': { outline: 'none' }, '.cm-scroller': { fontFamily: 'inherit', overflow: 'auto', maxHeight: '160px' }, '.cm-content': { fontFamily: 'inherit' }, '.cm-line': { padding: '0' }, '.cm-placeholder': { color: 'var(--fg-dim)' } }),
      Prec.highest(EditorView.domEventHandlers({
        keydown(event) {
          if (event.target instanceof HTMLElement && event.target.closest('[data-reference-id]')) {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); showReference(event.target); return true }
          }
          flushSync(() => latest.current.onKeyDown?.(event))
          return event.defaultPrevented
        },
        paste(event) { latest.current.onPaste?.(event); return event.defaultPrevented },
        focus() { latest.current.onFocus?.() }, blur() { latest.current.onBlur?.(); hoverRef.current.close() },
        click() { latest.current.onClick?.() }, keyup() { latest.current.onKeyUp?.() },
        mouseover(event) { showReference(event.target) }, mouseout() { hoverRef.current.close() },
        focusin(event) { showReference(event.target) }
      })),
      EditorView.updateListener.of(update => {
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
      view.dispatch({ effects: [refreshReferences.of(), editable.current.reconfigure([EditorState.readOnly.of(!!props.disabled), EditorView.editable.of(!props.disabled)])] })
      for (const name of ['aria-expanded', 'aria-controls', 'aria-activedescendant', 'aria-autocomplete'] as const) {
        const value = props[name]
        if (value === undefined) view.contentDOM.removeAttribute(name)
        else view.contentDOM.setAttribute(name, String(value))
      }
      view.contentDOM.contentEditable = String(!props.disabled)
      view.contentDOM.setAttribute('aria-disabled', String(!!props.disabled))
    } finally { syncing.current = false }
  }, [props.value, props.references, props.disabled, props['aria-expanded'], props['aria-controls'], props['aria-activedescendant']])
  return <div className="ac-rich-input" ref={host} onKeyDownCapture={event => {
    // Let the browser confirm IME text without running the editor's Enter keymap.
    if (event.nativeEvent.isComposing || event.keyCode === 229) event.stopPropagation()
  }}>{hover.preview}</div>
})
