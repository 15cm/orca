import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({}))

import { setMainWindowElectronBindings } from './main-window-electron-bindings'
import { _resetMainWindowRegistryForTests, registerMainWindow } from './main-window-registry'
import { installMainWindowTitle } from './main-window-title'
import {
  bindWindowToProjectGroup,
  findMainWindowForProjectGroup,
  getWindowScopeSnapshotForWebContents,
  openProjectGroupWindow,
  releaseWindowScope,
  releaseWindowsScopedToProjectGroups,
  setWindowScopeLabel,
  WINDOW_SCOPE_CHANGED_CHANNEL
} from './window-scope-binding'
import {
  _resetWindowViewStateRegistryForTests,
  bindWindowIdToWebContents,
  resolveWindowIdForWebContents,
  setScopedWindowsEnabled
} from './window-view-state-registry'

type WindowStub = {
  id: number
  webContents: {
    id: number
    isDestroyed: () => boolean
    send: ReturnType<typeof vi.fn>
  }
  isDestroyed: () => boolean
  isMinimized: () => boolean
  restore: ReturnType<typeof vi.fn>
  show: ReturnType<typeof vi.fn>
  focus: ReturnType<typeof vi.fn>
  setTitle: ReturnType<typeof vi.fn>
  on: () => void
  once: () => void
  removeListener: () => void
}

const seed = () => ({ filterRepoIds: ['persisted'], filterGroupIds: [] })
const PERC = { type: 'project-group' as const, projectGroupId: 'perc' }

function createWindow(id: number, windowId: string): WindowStub {
  const window: WindowStub = {
    id,
    webContents: { id: id * 10, isDestroyed: () => false, send: vi.fn() },
    isDestroyed: () => false,
    isMinimized: () => false,
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    setTitle: vi.fn(),
    on: () => {},
    once: () => {},
    removeListener: () => {}
  }
  registerMainWindow(window as never)
  bindWindowIdToWebContents(window.webContents.id, windowId)
  installMainWindowTitle(window as never, 'Orca')
  return window
}

describe('window scope binding', () => {
  beforeEach(() => {
    _resetMainWindowRegistryForTests()
    _resetWindowViewStateRegistryForTests()
    setScopedWindowsEnabled(true)
    setMainWindowElectronBindings({
      getFocusedWindow: () => null,
      fromWebContents: () => null,
      isBrowserWindow: (window): window is never => window !== null
    })
  })

  it('opens a project window under its scope key and titles it from the renderer label', () => {
    let opened: WindowStub | null = null
    const openWindow = vi.fn((windowId: string) => (opened = createWindow(1, windowId)) as never)

    const result = openProjectGroupWindow({
      projectGroupId: 'perc',
      projectLabel: 'Perc',
      openWindow
    })

    expect(result).toEqual({ status: 'opened' })
    expect(openWindow).toHaveBeenCalledWith('group:perc')
    expect(opened!.setTitle).toHaveBeenCalledWith('Perc — Orca')
    expect(findMainWindowForProjectGroup('perc')).toBe(opened)
    expect(getWindowScopeSnapshotForWebContents(opened!.webContents.id)).toEqual({
      scope: PERC,
      scopedWindowsEnabled: true
    })
  })

  it('reveals the existing window instead of opening a second one for the same project', () => {
    const existing = createWindow(1, 'group:perc')
    const openWindow = vi.fn()

    const result = openProjectGroupWindow({
      projectGroupId: 'perc',
      projectLabel: 'Perc',
      openWindow
    })

    expect(result).toEqual({ status: 'revealed-existing' })
    expect(openWindow).not.toHaveBeenCalled()
    expect(existing.show).toHaveBeenCalledTimes(1)
    expect(existing.focus).toHaveBeenCalledTimes(1)
  })

  it('cannot open or bind project windows while multi-window is off', () => {
    setScopedWindowsEnabled(false)
    const window = createWindow(1, 'win-a')
    const openWindow = vi.fn()

    expect(
      openProjectGroupWindow({
        projectGroupId: 'perc',
        projectLabel: null,
        openWindow
      })
    ).toEqual({
      status: 'unavailable'
    })
    expect(openWindow).not.toHaveBeenCalled()
    expect(
      bindWindowToProjectGroup(
        window as never,
        { projectGroupId: 'perc', projectLabel: 'Perc' },
        seed
      )
    ).toEqual({ status: 'unavailable' })
    expect(resolveWindowIdForWebContents(window.webContents.id)).toBe('win-a')
  })

  it('re-keys a live window onto a project and pushes the derived filter to its renderer', () => {
    const window = createWindow(1, 'win-a')

    const result = bindWindowToProjectGroup(
      window as never,
      { projectGroupId: 'perc', projectLabel: 'Perc' },
      seed
    )

    expect(result).toEqual({ status: 'bound', scope: PERC })
    expect(resolveWindowIdForWebContents(window.webContents.id)).toBe('group:perc')
    expect(window.setTitle).toHaveBeenLastCalledWith('Perc — Orca')
    expect(window.webContents.send).toHaveBeenCalledWith(WINDOW_SCOPE_CHANGED_CHANNEL, {
      scope: PERC,
      scopedWindowsEnabled: true,
      viewState: { filterRepoIds: [], filterGroupIds: ['perc'] }
    })
  })

  it('reveals the other window when the project is already bound elsewhere', () => {
    const other = createWindow(1, 'group:perc')
    const window = createWindow(2, 'win-b')

    const result = bindWindowToProjectGroup(
      window as never,
      { projectGroupId: 'perc', projectLabel: 'Perc' },
      seed
    )

    expect(result).toEqual({ status: 'revealed-existing' })
    expect(other.focus).toHaveBeenCalledTimes(1)
    expect(resolveWindowIdForWebContents(window.webContents.id)).toBe('win-b')
    expect(window.webContents.send).not.toHaveBeenCalled()
  })

  it('releases a scoped window into a free one seeded from the persisted filter', () => {
    const window = createWindow(1, 'group:perc')
    setWindowScopeLabel(window as never, 'Perc')

    const result = releaseWindowScope(window as never, seed)

    expect(result).toEqual({ status: 'released' })
    const windowId = resolveWindowIdForWebContents(window.webContents.id)
    expect(windowId).not.toBe('group:perc')
    expect(getWindowScopeSnapshotForWebContents(window.webContents.id).scope).toBeNull()
    expect(window.setTitle).toHaveBeenLastCalledWith('Orca')
    expect(window.webContents.send).toHaveBeenLastCalledWith(WINDOW_SCOPE_CHANGED_CHANNEL, {
      scope: null,
      scopedWindowsEnabled: true,
      viewState: { filterRepoIds: ['persisted'], filterGroupIds: [] }
    })
    expect(window.isDestroyed()).toBe(false)
  })

  it('releases the windows bound to deleted groups and leaves the rest alone', () => {
    const perc = createWindow(1, 'group:perc')
    const cce = createWindow(2, 'group:cce')

    releaseWindowsScopedToProjectGroups(['perc', 'services'], seed)

    expect(getWindowScopeSnapshotForWebContents(perc.webContents.id).scope).toBeNull()
    expect(getWindowScopeSnapshotForWebContents(cce.webContents.id).scope).toEqual({
      type: 'project-group',
      projectGroupId: 'cce'
    })
    expect(cce.webContents.send).not.toHaveBeenCalled()
  })

  it('ignores a project label for a free window', () => {
    const window = createWindow(1, 'win-a')

    setWindowScopeLabel(window as never, 'Perc')

    expect(window.setTitle).not.toHaveBeenCalled()
  })
})
