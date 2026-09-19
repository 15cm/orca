// @vitest-environment happy-dom
import { Terminal } from '@xterm/xterm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installTerminalImeDelayedCommitForwarder } from './terminal-ime-delayed-commit-forwarder'

function nextEventLoop(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0))
}

function openTerminal(): {
  emitted: string[]
  terminal: Terminal
  textarea: HTMLTextAreaElement
} {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const terminal = new Terminal()
  terminal.open(container)
  const textarea = terminal.textarea
  if (!textarea) {
    throw new Error('xterm helper textarea was not created')
  }
  const emitted: string[] = []
  terminal.onData((data) => emitted.push(data))
  return { emitted, terminal, textarea }
}

function dispatchCompositionEvent(
  textarea: HTMLTextAreaElement,
  type: 'compositionstart' | 'compositionupdate' | 'compositionend',
  data: string = ''
): void {
  const event = new CompositionEvent(type, { bubbles: true })
  // happy-dom ignores CompositionEventInit.data, but Chromium supplies it.
  Object.defineProperty(event, 'data', { value: data })
  textarea.dispatchEvent(event)
}

function dispatchProcessKeydown(textarea: HTMLTextAreaElement): void {
  const keydown = new KeyboardEvent('keydown', {
    key: 'Process',
    code: 'KeyC',
    isComposing: true,
    bubbles: true
  })
  Object.defineProperty(keydown, 'keyCode', { value: 229 })
  textarea.dispatchEvent(keydown)
}

function dispatchComposedInput(textarea: HTMLTextAreaElement, init: InputEventInit): void {
  const input = new InputEvent('input', { ...init, bubbles: true })
  Object.defineProperty(input, 'composed', { value: true })
  textarea.dispatchEvent(input)
}

function updatePreedit(textarea: HTMLTextAreaElement, text: string): void {
  dispatchProcessKeydown(textarea)
  dispatchCompositionEvent(textarea, 'compositionupdate', text)
  textarea.value = text
  dispatchComposedInput(textarea, { data: text, inputType: 'insertCompositionText' })
}

describe('xterm IME composition cancellation', () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      measureText: () => ({ width: 10 })
    } as unknown as CanvasRenderingContext2D)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.body.replaceChildren()
  })

  it('emits nothing when Backspace deletes the whole Pinyin preedit', async () => {
    const { emitted, terminal, textarea } = openTerminal()

    dispatchCompositionEvent(textarea, 'compositionstart')
    for (const preedit of ['c', 'ce', 'ces', 'cesh', 'ceshi']) {
      updatePreedit(textarea, preedit)
      await nextEventLoop()
    }
    for (const preedit of ['cesh', 'ces', 'ce', 'c']) {
      updatePreedit(textarea, preedit)
      await nextEventLoop()
    }
    // Final Backspace: Chromium clears the preedit and ends the composition
    // with empty data; the last non-empty compositionupdate was 'c'.
    dispatchProcessKeydown(textarea)
    dispatchCompositionEvent(textarea, 'compositionupdate')
    textarea.value = ''
    dispatchComposedInput(textarea, { inputType: 'deleteContentBackward' })
    dispatchCompositionEvent(textarea, 'compositionend')
    await nextEventLoop()

    expect(emitted).toEqual([])
    terminal.dispose()
  })

  it('drops a Sogou preedit cancelled without a trailing input event', async () => {
    const { emitted, terminal, textarea } = openTerminal()

    dispatchCompositionEvent(textarea, 'compositionstart')
    for (const preedit of ['nihao', 'niha', 'nih', 'ni', 'n']) {
      dispatchCompositionEvent(textarea, 'compositionupdate', preedit)
      textarea.value = preedit
      await nextEventLoop()
    }
    textarea.value = ''
    dispatchCompositionEvent(textarea, 'compositionend')
    await nextEventLoop()

    expect(emitted).toEqual([])
    terminal.dispose()
  })

  it('still emits an empty-end commit that delivers text via a following input event', async () => {
    const { emitted, terminal, textarea } = openTerminal()
    const forwarder = installTerminalImeDelayedCommitForwarder({
      terminalElement: terminal.element,
      sendInput: (data) => terminal.input(data)
    })

    dispatchCompositionEvent(textarea, 'compositionstart')
    dispatchCompositionEvent(textarea, 'compositionupdate', '한')
    textarea.value = '한'
    await nextEventLoop()
    // IBus clears the textarea at compositionend, then restores the commit
    // through a bare insertText — evidence that this end was not a cancel.
    textarea.value = ''
    dispatchCompositionEvent(textarea, 'compositionend')
    textarea.value = '한'
    dispatchComposedInput(textarea, { data: '한', inputType: 'insertText' })
    await nextEventLoop()

    expect(emitted.join('')).toBe('한')
    forwarder.dispose()
    terminal.dispose()
  })

  it('emits a delayed commit after a voice-input status preedit is cleared', async () => {
    const { emitted, terminal, textarea } = openTerminal()
    const forwarder = installTerminalImeDelayedCommitForwarder({
      terminalElement: terminal.element,
      sendInput: (data) => terminal.input(data)
    })

    dispatchCompositionEvent(textarea, 'compositionstart')
    updatePreedit(textarea, 'Recording…')
    await nextEventLoop()
    textarea.value = ''
    dispatchCompositionEvent(textarea, 'compositionend')
    // fcitx5-vinput receives its recognition result asynchronously after clearing status preedit.
    await nextEventLoop()
    textarea.value = 'voice result'
    dispatchComposedInput(textarea, { data: 'voice result', inputType: 'insertText' })
    await nextEventLoop()

    expect(emitted.join('')).toBe('voice result')
    forwarder.dispose()
    terminal.dispose()
  })

  it('emits a delayed vinput commit when its trigger keyup is swallowed', async () => {
    const { emitted, terminal, textarea } = openTerminal()
    let now = 0
    const forwarder = installTerminalImeDelayedCommitForwarder({
      terminalElement: terminal.element,
      sendInput: (data) => terminal.input(data),
      now: () => now
    })

    const keydown = new KeyboardEvent('keydown', {
      key: 'Alt',
      code: 'AltRight',
      bubbles: true
    })
    Object.defineProperty(keydown, 'keyCode', { value: 18 })
    textarea.dispatchEvent(keydown)
    now = 3_500
    textarea.value = 'voice result'
    dispatchComposedInput(textarea, { data: 'voice result', inputType: 'insertText' })
    await nextEventLoop()

    expect(emitted.join('')).toBe('voice result')
    forwarder.dispose()
    terminal.dispose()
  })

  it('leaves an active composition commit with xterm after a long-held IME key', async () => {
    const { emitted, terminal, textarea } = openTerminal()
    let now = 0
    const forwarder = installTerminalImeDelayedCommitForwarder({
      terminalElement: terminal.element,
      sendInput: (data) => terminal.input(data),
      now: () => now
    })

    dispatchCompositionEvent(textarea, 'compositionstart')
    updatePreedit(textarea, 'hao')
    now = 3_500
    textarea.value = '好'
    dispatchCompositionEvent(textarea, 'compositionend', '好')
    dispatchComposedInput(textarea, { data: '好', inputType: 'insertText' })
    await nextEventLoop()

    expect(emitted.join('')).toBe('好')
    forwarder.dispose()
    terminal.dispose()
  })

  it('leaves ordinary typing after a cleared preedit with xterm', async () => {
    const { emitted, terminal, textarea } = openTerminal()
    const delayedForwards: string[] = []
    const forwarder = installTerminalImeDelayedCommitForwarder({
      terminalElement: terminal.element,
      sendInput: (data) => {
        delayedForwards.push(data)
        terminal.input(data)
      }
    })

    dispatchCompositionEvent(textarea, 'compositionstart')
    updatePreedit(textarea, 'Recording…')
    await nextEventLoop()
    textarea.value = ''
    dispatchCompositionEvent(textarea, 'compositionend')
    await nextEventLoop()
    const keydown = new KeyboardEvent('keydown', {
      key: 'a',
      code: 'KeyA',
      bubbles: true
    })
    Object.defineProperty(keydown, 'keyCode', { value: 65 })
    textarea.dispatchEvent(keydown)
    textarea.value = 'a'
    dispatchComposedInput(textarea, { data: 'a', inputType: 'insertText' })
    await nextEventLoop()

    expect(delayedForwards).toEqual([])
    expect(emitted).toContain('a')
    forwarder.dispose()
    terminal.dispose()
  })
})
