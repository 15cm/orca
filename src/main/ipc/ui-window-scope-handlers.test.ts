import { beforeEach, describe, expect, it, vi } from 'vitest'

const { handleMock, onMock, removeAllListenersMock } = vi.hoisted(() => ({
  handleMock: vi.fn(),
  onMock: vi.fn(),
  removeAllListenersMock: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: handleMock,
    on: onMock,
    removeAllListeners: removeAllListenersMock
  }
}))

import { getDefaultUIState } from '../../shared/constants'
import { setMainWindowElectronBindings } from '../window/main-window-electron-bindings'
import {
  _resetMainWindowRegistryForTests,
  registerMainWindow
} from '../window/main-window-registry'
import { installMainWindowTitle } from '../window/main-window-title'
import {
  _resetWindowViewStateRegistryForTests,
  bindWindowIdToWebContents,
  resolveWindowIdForWebContents,
  setScopedWindowsEnabled
} from '../window/window-view-state-registry'
import { registerUIWindowScopeHandlers } from './ui-window-scope-handlers'

type Handler = (event: { sender: unknown }, args?: unknown) => unknown

function handlerFor(channel: string): Handler {
  const call = handleMock.mock.calls.find(([name]) => name === channel)
  if (!call) {
    throw new Error(`handler for ${channel} not registered`)
  }
  return call[1] as Handler
}

function createWindow(id: number, windowId: string) {
  const window = {
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

describe('UI window scope IPC', () => {
  const store = {
    getUI: () => ({ ...getDefaultUIState(), filterRepoIds: ['persisted'] })
  }
  let windows: ReturnType<typeof createWindow>[] = []

  beforeEach(() => {
    handleMock.mockReset()
    onMock.mockReset()
    _resetMainWindowRegistryForTests()
    _resetWindowViewStateRegistryForTests()
    setScopedWindowsEnabled(true)
    windows = []
    setMainWindowElectronBindings({
      getFocusedWindow: () => null,
      fromWebContents: (webContents) =>
        (windows.find((window) => (window.webContents as unknown) === webContents) ??
          null) as never,
      isBrowserWindow: (window): window is never => windows.includes(window as never)
    })
  })

  it('answers the sender window scope from the registry, not from argv', () => {
    const window = createWindow(1, 'group:perc')
    windows = [window]
    registerUIWindowScopeHandlers(store)

    expect(handlerFor('ui:getWindowScope')({ sender: window.webContents })).toEqual({
      scope: { type: 'project-group', projectGroupId: 'perc' },
      scopedWindowsEnabled: true
    })
    expect(handlerFor('ui:getWindowScope')({ sender: { id: 999 } })).toEqual({
      scope: null,
      scopedWindowsEnabled: true
    })
  })

  it('binds and releases only real main windows, rejecting malformed args', async () => {
    const window = createWindow(1, 'win-a')
    windows = [window]
    registerUIWindowScopeHandlers(store)
    const setScope = handlerFor('ui:setWindowScope')

    expect(await setScope({ sender: { id: 999 } }, { projectGroupId: 'perc' })).toEqual({
      status: 'unavailable'
    })
    expect(await setScope({ sender: window.webContents }, { projectGroupId: '' })).toEqual({
      status: 'unavailable'
    })
    expect(
      await setScope(
        { sender: window.webContents },
        { projectGroupId: 'perc', projectLabel: 'Perc' }
      )
    ).toEqual({
      status: 'bound',
      scope: { type: 'project-group', projectGroupId: 'perc' }
    })
    expect(resolveWindowIdForWebContents(window.webContents.id)).toBe('group:perc')
    expect(await setScope({ sender: window.webContents }, null)).toEqual({
      status: 'released'
    })
    expect(resolveWindowIdForWebContents(window.webContents.id)).not.toBe('group:perc')
  })

  it('opens a project window through the injected opener and is unavailable without one', async () => {
    const requester = createWindow(1, 'win-a')
    windows = [requester]
    registerUIWindowScopeHandlers(store)
    expect(
      await handlerFor('ui:openProjectGroupWindow')(
        { sender: requester.webContents },
        { projectGroupId: 'perc' }
      )
    ).toEqual({ status: 'unavailable' })

    handleMock.mockReset()
    const openScopedMainWindow = vi.fn((windowId: string) => {
      const opened = createWindow(2, windowId)
      windows.push(opened)
      return opened as never
    })
    registerUIWindowScopeHandlers(store, { openScopedMainWindow })

    expect(
      await handlerFor('ui:openProjectGroupWindow')(
        { sender: requester.webContents },
        { projectGroupId: 'perc', projectLabel: 'Perc' }
      )
    ).toEqual({ status: 'opened' })
    expect(openScopedMainWindow).toHaveBeenCalledWith('group:perc')
    expect(windows[1]!.setTitle).toHaveBeenCalledWith('Perc — Orca')
  })

  it('applies a trimmed project label to scoped windows only', () => {
    const scoped = createWindow(1, 'group:perc')
    const free = createWindow(2, 'win-b')
    windows = [scoped, free]
    registerUIWindowScopeHandlers(store)
    const onLabel = onMock.mock.calls.find(([channel]) => channel === 'ui:setWindowScopeLabel')?.[1]

    onLabel({ sender: scoped.webContents }, '  Perc  ')
    onLabel({ sender: free.webContents }, 'Perc')
    onLabel({ sender: scoped.webContents }, 42)

    expect(scoped.setTitle).toHaveBeenNthCalledWith(1, 'Perc — Orca')
    expect(scoped.setTitle).toHaveBeenLastCalledWith('Orca')
    expect(free.setTitle).not.toHaveBeenCalled()
  })
})
