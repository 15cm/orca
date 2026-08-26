import type { BrowserWindow } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { revealExistingMainWindow, shouldReuseExistingMainWindow } from './main-window-open-policy'

function makeWindow(options: { destroyed?: boolean; minimized?: boolean } = {}): BrowserWindow & {
  restore: ReturnType<typeof vi.fn>
  show: ReturnType<typeof vi.fn>
  focus: ReturnType<typeof vi.fn>
} {
  return {
    isDestroyed: vi.fn(() => options.destroyed ?? false),
    isMinimized: vi.fn(() => options.minimized ?? false),
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn()
  } as unknown as BrowserWindow & {
    restore: ReturnType<typeof vi.fn>
    show: ReturnType<typeof vi.fn>
    focus: ReturnType<typeof vi.fn>
  }
}

describe('main-window-open-policy', () => {
  it('reuses existing window when multi-window is off', () => {
    const existingWindow = makeWindow()

    expect(
      shouldReuseExistingMainWindow({
        experimentalMultiWindowEnabledAtStartup: false,
        existingWindow
      })
    ).toBe(true)
  })

  it('allows a new window only when multi-window is enabled', () => {
    const existingWindow = makeWindow()

    expect(
      shouldReuseExistingMainWindow({
        experimentalMultiWindowEnabledAtStartup: true,
        forceNewWindow: true,
        existingWindow
      })
    ).toBe(false)
  })

  it('does not reuse destroyed windows', () => {
    expect(
      shouldReuseExistingMainWindow({
        experimentalMultiWindowEnabledAtStartup: false,
        existingWindow: makeWindow({ destroyed: true })
      })
    ).toBe(false)
  })

  it('reveals and focuses reused window', () => {
    const existingWindow = makeWindow({ minimized: true })

    expect(revealExistingMainWindow(existingWindow)).toBe(existingWindow)
    expect(existingWindow.restore).toHaveBeenCalledOnce()
    expect(existingWindow.show).toHaveBeenCalledOnce()
    expect(existingWindow.focus).toHaveBeenCalledOnce()
  })
})
