import type { IDisposable } from '@xterm/xterm'
import { XTERM_COMPOSITION_TRANSACTION_SETTLED_EVENT } from './terminal-ime-native-text-forwarder'

/** Forwards asynchronous IME commits that arrive after their status preedit has settled. */
export function installTerminalImeDelayedCommitForwarder(args: {
  terminalElement: HTMLElement | null | undefined
  sendInput: (data: string) => void
}): IDisposable {
  if (!args.terminalElement) {
    return { dispose: () => undefined }
  }

  const terminalElement = args.terminalElement
  let sawPreedit = false
  let emptyEndPending = false
  let awaitingCommit = false

  const reset = (): void => {
    sawPreedit = false
    emptyEndPending = false
    awaitingCommit = false
  }
  const onCompositionStart = (): void => reset()
  const onCompositionUpdate = (event: Event): void => {
    if (event instanceof CompositionEvent && event.data !== '') {
      sawPreedit = true
    }
  }
  const onCompositionEnd = (event: Event): void => {
    emptyEndPending = sawPreedit && event instanceof CompositionEvent && event.data === ''
    sawPreedit = false
    awaitingCommit = false
  }
  const onTransactionSettled = (): void => {
    awaitingCommit = emptyEndPending
    emptyEndPending = false
  }
  const onKeyDown = (): void => {
    // A physical key means ordinary typing resumed; xterm owns its following input event.
    awaitingCommit = false
    emptyEndPending = false
  }
  const onInput = (event: Event): void => {
    if (!(event instanceof InputEvent)) {
      return
    }
    if (!awaitingCommit || event.inputType !== 'insertText' || !event.data) {
      if (event.inputType !== 'insertCompositionText') {
        awaitingCommit = false
        emptyEndPending = false
      }
      return
    }
    awaitingCommit = false
    args.sendInput(event.data)
    event.stopImmediatePropagation()
    if (event.target instanceof HTMLTextAreaElement) {
      event.target.value = ''
    }
  }

  terminalElement.addEventListener('compositionstart', onCompositionStart, true)
  terminalElement.addEventListener('compositionupdate', onCompositionUpdate, true)
  terminalElement.addEventListener('compositionend', onCompositionEnd, true)
  terminalElement.addEventListener(
    XTERM_COMPOSITION_TRANSACTION_SETTLED_EVENT,
    onTransactionSettled,
    true
  )
  terminalElement.addEventListener('keydown', onKeyDown, true)
  terminalElement.addEventListener('input', onInput, true)
  terminalElement.addEventListener('blur', reset, true)

  return {
    dispose: () => {
      reset()
      terminalElement.removeEventListener('compositionstart', onCompositionStart, true)
      terminalElement.removeEventListener('compositionupdate', onCompositionUpdate, true)
      terminalElement.removeEventListener('compositionend', onCompositionEnd, true)
      terminalElement.removeEventListener(
        XTERM_COMPOSITION_TRANSACTION_SETTLED_EVENT,
        onTransactionSettled,
        true
      )
      terminalElement.removeEventListener('keydown', onKeyDown, true)
      terminalElement.removeEventListener('input', onInput, true)
      terminalElement.removeEventListener('blur', reset, true)
    }
  }
}
