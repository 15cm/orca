import type { IDisposable } from '@xterm/xterm'
import { XTERM_COMPOSITION_TRANSACTION_SETTLED_EVENT } from './terminal-ime-native-text-forwarder'

const DELAYED_STANDALONE_COMMIT_MS = 250

/** Forwards asynchronous IME commits that outlive their preedit or swallowed trigger keyup. */
export function installTerminalImeDelayedCommitForwarder(args: {
  terminalElement: HTMLElement | null | undefined
  sendInput: (data: string) => void
  now?: () => number
}): IDisposable {
  if (!args.terminalElement) {
    return { dispose: () => undefined }
  }

  const terminalElement = args.terminalElement
  const now = args.now ?? (() => performance.now())
  const pressedAt = new Map<string, number>()
  let sawPreedit = false
  let emptyEndPending = false
  let awaitingCommit = false
  let compositionTransactionPending = false

  const reset = (): void => {
    pressedAt.clear()
    sawPreedit = false
    emptyEndPending = false
    awaitingCommit = false
    compositionTransactionPending = false
  }
  const onCompositionStart = (): void => {
    reset()
    compositionTransactionPending = true
  }
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
    compositionTransactionPending = false
  }
  const onKeyDown = (event: Event): void => {
    awaitingCommit = false
    emptyEndPending = false
    if (event instanceof KeyboardEvent) {
      pressedAt.set(event.code || event.key, now())
    }
  }
  const onKeyUp = (event: Event): void => {
    if (event instanceof KeyboardEvent) {
      pressedAt.delete(event.code || event.key)
    }
  }
  const hasDelayedPressedKey = (): boolean => {
    const currentTime = now()
    for (const pressedSince of pressedAt.values()) {
      if (currentTime - pressedSince >= DELAYED_STANDALONE_COMMIT_MS) {
        return true
      }
    }
    return false
  }
  const onInput = (event: Event): void => {
    if (!(event instanceof InputEvent)) {
      return
    }
    const isTextCommit = event.inputType === 'insertText' && !!event.data
    const delayedAfterSwallowedKeyUp =
      isTextCommit && !compositionTransactionPending && hasDelayedPressedKey()
    if ((!awaitingCommit && !delayedAfterSwallowedKeyUp) || !isTextCommit) {
      if (event.inputType !== 'insertCompositionText') {
        awaitingCommit = false
        emptyEndPending = false
        pressedAt.clear()
      }
      return
    }
    awaitingCommit = false
    pressedAt.clear()
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
  terminalElement.addEventListener('keyup', onKeyUp, true)
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
      terminalElement.removeEventListener('keyup', onKeyUp, true)
      terminalElement.removeEventListener('input', onInput, true)
      terminalElement.removeEventListener('blur', reset, true)
    }
  }
}
