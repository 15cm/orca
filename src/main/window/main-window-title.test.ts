import type { BrowserWindow } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import {
  composeMainWindowTitle,
  installMainWindowTitle,
  setMainWindowProjectLabel
} from './main-window-title'

type TitleListener = (event: { preventDefault: () => void }) => void

function makeWindow(): BrowserWindow & {
  setTitle: ReturnType<typeof vi.fn>
  emitPageTitleUpdated: () => boolean
} {
  let listener: TitleListener | null = null
  const window = {
    isDestroyed: () => false,
    setTitle: vi.fn(),
    on: vi.fn((event: string, handler: TitleListener) => {
      if (event === 'page-title-updated') {
        listener = handler
      }
    }),
    emitPageTitleUpdated: () => {
      let prevented = false
      listener?.({ preventDefault: () => (prevented = true) })
      return prevented
    }
  }
  return window as unknown as ReturnType<typeof makeWindow>
}

describe('main window title', () => {
  it('composes "<project> — <app>" only while a project label is set', () => {
    expect(composeMainWindowTitle('Orca', null)).toBe('Orca')
    expect(composeMainWindowTitle('Orca', '   ')).toBe('Orca')
    expect(composeMainWindowTitle('Orca (dev)', 'Perc')).toBe('Perc — Orca (dev)')
  })

  it('keeps the project title across the renderer <title> and restores the app name on release', () => {
    const window = makeWindow()
    installMainWindowTitle(window, 'Orca (dev)')

    expect(window.emitPageTitleUpdated()).toBe(false)

    setMainWindowProjectLabel(window, 'Perc')

    expect(window.setTitle).toHaveBeenLastCalledWith('Perc — Orca (dev)')
    expect(window.emitPageTitleUpdated()).toBe(true)

    setMainWindowProjectLabel(window, null)

    expect(window.setTitle).toHaveBeenLastCalledWith('Orca (dev)')
    expect(window.emitPageTitleUpdated()).toBe(false)
  })
})
