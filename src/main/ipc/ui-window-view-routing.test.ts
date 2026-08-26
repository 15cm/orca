import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({}))

import { getDefaultUIState } from '../../shared/constants'
import type { PersistedUIState } from '../../shared/persisted-ui-state-types'
import { setMainWindowElectronBindings } from '../window/main-window-electron-bindings'
import {
  _resetMainWindowRegistryForTests,
  registerMainWindow
} from '../window/main-window-registry'
import {
  _resetWindowViewStateRegistryForTests,
  bindWindowIdToWebContents,
  getWindowViewState,
  setScopedWindowsEnabled
} from '../window/window-view-state-registry'
import {
  applyRendererUIUpdate,
  overlayWindowViewState,
  readUIForRenderer
} from './ui-window-view-routing'

type WindowStub = {
  id: number
  webContents: { id: number; isDestroyed: () => boolean }
  isDestroyed: () => boolean
  on: () => void
  once: () => void
  removeListener: () => void
}

function createWindow(id: number): WindowStub {
  return {
    id,
    webContents: { id: id * 10, isDestroyed: () => false },
    isDestroyed: () => false,
    on: () => {},
    once: () => {},
    removeListener: () => {}
  }
}

function makeStore(overrides: Partial<PersistedUIState> = {}) {
  let ui: PersistedUIState = { ...getDefaultUIState(), ...overrides }
  return {
    getUI: vi.fn(() => ui),
    updateUI: vi.fn((updates: Partial<PersistedUIState>) => {
      ui = { ...ui, ...updates }
    })
  }
}

describe('UI window-view routing', () => {
  const windowA = createWindow(1)
  const windowB = createWindow(2)
  let focused: WindowStub | null = windowA

  beforeEach(() => {
    _resetMainWindowRegistryForTests()
    _resetWindowViewStateRegistryForTests()
    focused = windowA
    setMainWindowElectronBindings({
      getFocusedWindow: () => focused as never,
      fromWebContents: (webContents) =>
        ([windowA, windowB].find((window) => window.webContents === webContents) ?? null) as never,
      isBrowserWindow: (window): window is never => [windowA, windowB].includes(window as never)
    })
    registerMainWindow(windowA as never)
    registerMainWindow(windowB as never)
    bindWindowIdToWebContents(windowA.webContents.id, 'win-a')
    bindWindowIdToWebContents(windowB.webContents.id, 'win-b')
  })

  it('seeds a new window from the persisted filter on its first read', () => {
    const store = makeStore({ filterRepoIds: ['persisted'], filterGroupIds: ['group-1'] })

    const ui = readUIForRenderer(store, windowA.webContents)

    expect(ui.filterRepoIds).toEqual(['persisted'])
    expect(ui.filterGroupIds).toEqual(['group-1'])
    expect(getWindowViewState('win-a')).toEqual({
      filterRepoIds: ['persisted'],
      filterGroupIds: ['group-1']
    })
  })

  it('keeps each window filter isolated while the focused one rewrites the persisted seed', () => {
    const store = makeStore({ filterRepoIds: ['persisted'] })
    readUIForRenderer(store, windowA.webContents)
    readUIForRenderer(store, windowB.webContents)

    applyRendererUIUpdate(store, windowA.webContents as never, { filterRepoIds: ['perc'] })

    expect(readUIForRenderer(store, windowA.webContents).filterRepoIds).toEqual(['perc'])
    expect(readUIForRenderer(store, windowB.webContents).filterRepoIds).toEqual(['persisted'])
    expect(store.getUI().filterRepoIds).toEqual(['perc'])

    focused = windowB
    applyRendererUIUpdate(store, windowB.webContents as never, { filterRepoIds: ['cce'] })

    expect(readUIForRenderer(store, windowA.webContents).filterRepoIds).toEqual(['perc'])
    expect(readUIForRenderer(store, windowB.webContents).filterRepoIds).toEqual(['cce'])
    expect(store.getUI().filterRepoIds).toEqual(['cce'])
  })

  it('does not let a background window overwrite the persisted seed', () => {
    const store = makeStore({ filterRepoIds: ['persisted'] })
    focused = windowA

    applyRendererUIUpdate(store, windowB.webContents as never, {
      filterRepoIds: ['pruned-in-background'],
      filterGroupIds: []
    })

    expect(getWindowViewState('win-b')?.filterRepoIds).toEqual(['pruned-in-background'])
    expect(store.updateUI).not.toHaveBeenCalled()
    expect(store.getUI().filterRepoIds).toEqual(['persisted'])
  })

  it('falls back to the last active window when nothing is focused', () => {
    const store = makeStore()
    focused = null

    // Why: registration order makes windowB the last active window.
    applyRendererUIUpdate(store, windowB.webContents as never, { filterRepoIds: ['cce'] })
    applyRendererUIUpdate(store, windowA.webContents as never, { filterRepoIds: ['perc'] })

    expect(store.getUI().filterRepoIds).toEqual(['cce'])
  })

  it('writes global keys straight through without touching window state', () => {
    const store = makeStore()

    applyRendererUIUpdate(store, windowB.webContents as never, { uiZoomLevel: 2 })

    expect(store.updateUI).toHaveBeenCalledWith({ uiZoomLevel: 2 })
    expect(getWindowViewState('win-b')).toBeNull()
  })

  it('splits a mixed payload so global keys persist from any window', () => {
    const store = makeStore()
    focused = windowA

    applyRendererUIUpdate(store, windowB.webContents as never, {
      filterGroupIds: ['group-1'],
      sidebarWidth: 320
    })

    expect(store.updateUI).toHaveBeenCalledWith({ sidebarWidth: 320 })
    expect(getWindowViewState('win-b')?.filterGroupIds).toEqual(['group-1'])
  })

  it('keeps the pre-feature global write for renderers outside a main window', () => {
    const store = makeStore()
    const popout = { id: 999 }

    applyRendererUIUpdate(store, popout as never, { filterRepoIds: ['x'], uiZoomLevel: 1 })

    expect(store.updateUI).toHaveBeenCalledWith({ filterRepoIds: ['x'], uiZoomLevel: 1 })
    expect(readUIForRenderer(store, popout)).toBe(store.getUI())
  })

  it('overlays each window own filter on a profile broadcast', () => {
    const store = makeStore({ filterRepoIds: ['persisted'] })
    focused = windowA
    applyRendererUIUpdate(store, windowA.webContents as never, { filterRepoIds: ['perc'] })
    const broadcast = store.getUI()

    expect(overlayWindowViewState(broadcast, windowA.webContents.id).filterRepoIds).toEqual([
      'perc'
    ])
    // Why: windowB never read or wrote, so it has no view-state yet and sees the profile as-is.
    expect(overlayWindowViewState(broadcast, windowB.webContents.id)).toBe(broadcast)
    expect(overlayWindowViewState(broadcast, 999)).toBe(broadcast)
  })

  it('never lets a project-scoped window rewrite the persisted seed, even when focused', () => {
    // Why: the seed is what mobile and the next free window read (remote-wire-compatibility, Rule 3).
    setScopedWindowsEnabled(true)
    bindWindowIdToWebContents(windowA.webContents.id, 'group:perc')
    const store = makeStore({
      filterRepoIds: ['persisted'],
      filterGroupIds: ['other']
    })
    focused = windowA

    const ui = readUIForRenderer(store, windowA.webContents)
    applyRendererUIUpdate(store, windowA.webContents as never, {
      filterRepoIds: ['cli'],
      filterGroupIds: [],
      sidebarWidth: 300
    })

    expect(ui.filterGroupIds).toEqual(['perc'])
    expect(ui.filterRepoIds).toEqual([])
    expect(store.updateUI).toHaveBeenCalledTimes(1)
    expect(store.updateUI).toHaveBeenCalledWith({ sidebarWidth: 300 })
    expect(store.getUI().filterRepoIds).toEqual(['persisted'])
    expect(store.getUI().filterGroupIds).toEqual(['other'])
    expect(getWindowViewState('group:perc')).toEqual({
      filterRepoIds: ['cli'],
      filterGroupIds: ['perc']
    })
  })
})
