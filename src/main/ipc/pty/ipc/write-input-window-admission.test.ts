import { describe, expect, it, vi, beforeEach } from 'vitest'

const fromWebContentsMock = vi.fn()
vi.mock('../../../window/main-window-registry', () => ({
  getMainWindowForWebContents: (webContents: unknown) => fromWebContentsMock(webContents)
}))

import { isMainWindowPtyIpcEvent } from './write-input'

function event(sender: { isDestroyed: () => boolean }) {
  return { sender } as never
}

const liveSender = { isDestroyed: () => false }

describe('isMainWindowPtyIpcEvent', () => {
  beforeEach(() => {
    fromWebContentsMock.mockReset()
  })

  it('admits input from a second window, which is what multi-window typing needs', () => {
    // Why this case: handlers are installed per window and each install replaces the
    // previous listener, so pinning admission to one window muted every other window.
    const secondWindow = { isDestroyed: () => false }
    fromWebContentsMock.mockReturnValue(secondWindow)
    expect(isMainWindowPtyIpcEvent(event(liveSender))).toBe(true)
  })

  it('rejects a sender that belongs to no registered main window', () => {
    fromWebContentsMock.mockReturnValue(null)
    expect(isMainWindowPtyIpcEvent(event(liveSender))).toBe(false)
  })

  it('rejects a destroyed window without dereferencing it', () => {
    // Why: reading `.webContents` off a destroyed window threw `Object has been
    // destroyed` at the call site, turning every later keystroke into an uncaught
    // main-process exception that reopened the error dialog forever.
    fromWebContentsMock.mockReturnValue({ isDestroyed: () => true })
    expect(isMainWindowPtyIpcEvent(event(liveSender))).toBe(false)
  })

  it('rejects a destroyed sender before asking the registry', () => {
    expect(isMainWindowPtyIpcEvent(event({ isDestroyed: () => true }))).toBe(false)
    expect(fromWebContentsMock).not.toHaveBeenCalled()
  })
})
