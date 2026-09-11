import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  fromIdMock,
  fromWebContentsMock,
  getAllWebContentsMock,
  getAllWindowsMock,
  handleMock,
  onMock,
  removeAllListenersMock
} = vi.hoisted(() => ({
  fromIdMock: vi.fn(),
  fromWebContentsMock: vi.fn(),
  getAllWebContentsMock: vi.fn(),
  getAllWindowsMock: vi.fn(() => []),
  handleMock: vi.fn(),
  onMock: vi.fn(),
  removeAllListenersMock: vi.fn()
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    fromWebContents: fromWebContentsMock,
    getAllWindows: getAllWindowsMock
  },
  ipcMain: {
    handle: handleMock,
    on: onMock,
    removeAllListeners: removeAllListenersMock
  },
  webContents: {
    fromId: fromIdMock,
    getAllWebContents: getAllWebContentsMock
  }
}))

import {
  clearTrustedUIRendererWebContentsId,
  getTrustedUIRendererWindow,
  registerUIHandlers,
  sendToTrustedUIRenderer,
  setTrustedUIRendererWebContentsId
} from './ui'
import {
  _resetWindowViewStateRegistryForTests,
  bindWindowIdToWebContents
} from '../window/window-view-state-registry'

function makeStore() {
  return {
    onUIChanged: vi.fn(),
    getUI: vi.fn(() => ({})),
    updateUI: vi.fn(),
    recordFeatureInteraction: vi.fn()
  }
}

function makeUIEvent(senderOverrides: Record<string, unknown> = {}): {
  sender: Record<string, unknown>
} {
  return {
    sender: {
      id: 17,
      getType: () => 'window',
      getURL: () => 'file:///orca/index.html',
      isDestroyed: () => false,
      ...senderOverrides
    }
  }
}

function getNativePasteHandler():
  | ((event: ReturnType<typeof makeUIEvent>, options?: { mode?: unknown }) => void)
  | undefined {
  return onMock.mock.calls.find(([channel]) => channel === 'ui:performNativePaste')?.[1]
}

function getNativeSelectionActionHandler():
  | ((event: ReturnType<typeof makeUIEvent>, action: unknown) => void)
  | undefined {
  return onMock.mock.calls.find(([channel]) => channel === 'ui:performNativeSelectionAction')?.[1]
}

describe('UI IPC', () => {
  beforeEach(() => {
    vi.stubEnv('ELECTRON_RENDERER_URL', '')
    fromIdMock.mockReset()
    fromWebContentsMock.mockReset()
    getAllWebContentsMock.mockReset()
    getAllWebContentsMock.mockReturnValue([])
    getAllWindowsMock.mockReset()
    getAllWindowsMock.mockReturnValue([])
    handleMock.mockReset()
    onMock.mockReset()
    removeAllListenersMock.mockReset()
    setTrustedUIRendererWebContentsId(null)
    _resetWindowViewStateRegistryForTests()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('sends app events once to the trusted renderer without waking 100 browser guests', () => {
    const rendererSend = vi.fn()
    const guestSends = Array.from({ length: 100 }, () => vi.fn())
    getAllWebContentsMock.mockReturnValue(
      guestSends.map((send, index) => ({
        id: index + 100,
        isDestroyed: () => false,
        send
      }))
    )
    fromIdMock.mockReturnValue({ id: 17, isDestroyed: () => false, send: rendererSend })
    setTrustedUIRendererWebContentsId(17)

    sendToTrustedUIRenderer('gh:prRefreshEvent', { sequence: 1 })

    expect(fromIdMock).toHaveBeenCalledOnce()
    expect(fromIdMock).toHaveBeenCalledWith(17)
    expect(rendererSend).toHaveBeenCalledOnce()
    expect(rendererSend).toHaveBeenCalledWith('gh:prRefreshEvent', { sequence: 1 })
    expect(getAllWebContentsMock).not.toHaveBeenCalled()
    expect(guestSends.reduce((total, send) => total + send.mock.calls.length, 0)).toBe(0)
  })

  it('resolves only the BrowserWindow that owns the trusted renderer', () => {
    const renderer = { id: 17, isDestroyed: () => false }
    const mainWindow = { id: 'main' }
    fromIdMock.mockReturnValue(renderer)
    fromWebContentsMock.mockReturnValue(mainWindow)
    setTrustedUIRendererWebContentsId(17)

    expect(getTrustedUIRendererWindow()).toBe(mainWindow)
    expect(fromWebContentsMock).toHaveBeenCalledWith(renderer)

    fromIdMock.mockReturnValue({ id: 17, isDestroyed: () => true })
    expect(getTrustedUIRendererWindow()).toBeNull()
  })

  it('skips missing, destroyed, and originating renderers', () => {
    const rendererSend = vi.fn()
    setTrustedUIRendererWebContentsId(17)

    fromIdMock.mockReturnValueOnce(undefined)
    sendToTrustedUIRenderer('gh:workItemMutated', { number: 7 })

    fromIdMock.mockReturnValueOnce({ id: 17, isDestroyed: () => true, send: rendererSend })
    sendToTrustedUIRenderer('gh:workItemMutated', { number: 7 })

    sendToTrustedUIRenderer('gh:workItemMutated', { number: 7 }, 17)

    expect(fromIdMock).toHaveBeenCalledTimes(2)
    expect(rendererSend).not.toHaveBeenCalled()
  })

  it('routes to a reopened window without retaining the closed renderer', () => {
    const oldRendererSend = vi.fn()
    const newRendererSend = vi.fn()
    fromIdMock.mockImplementation((id) =>
      id === 17
        ? { id, isDestroyed: () => false, send: oldRendererSend }
        : { id, isDestroyed: () => false, send: newRendererSend }
    )

    setTrustedUIRendererWebContentsId(17)
    sendToTrustedUIRenderer('gh:prRefreshEvent', { sequence: 1 })

    setTrustedUIRendererWebContentsId(42)
    clearTrustedUIRendererWebContentsId(17)
    sendToTrustedUIRenderer('gh:prRefreshEvent', { sequence: 2 })

    clearTrustedUIRendererWebContentsId(42)
    sendToTrustedUIRenderer('gh:prRefreshEvent', { sequence: 3 })

    expect(oldRendererSend).toHaveBeenCalledTimes(1)
    expect(newRendererSend).toHaveBeenCalledTimes(1)
    expect(newRendererSend).toHaveBeenCalledWith('gh:prRefreshEvent', { sequence: 2 })
  })

  it('routes native paste fallback to the requesting webContents only', () => {
    const paste = vi.fn()
    const pasteAndMatchStyle = vi.fn()
    const event = makeUIEvent()
    const sender = event.sender
    setTrustedUIRendererWebContentsId(17)
    fromWebContentsMock.mockReturnValue({ webContents: { paste, pasteAndMatchStyle } })

    registerUIHandlers(makeStore() as never)

    expect(removeAllListenersMock).toHaveBeenCalledWith('ui:performNativePaste')
    const nativePasteHandler = getNativePasteHandler()
    nativePasteHandler?.(event)
    nativePasteHandler?.(event, { mode: 'paste-and-match-style' })

    expect(fromWebContentsMock).toHaveBeenCalledWith(sender)
    expect(paste).toHaveBeenCalledTimes(1)
    expect(pasteAndMatchStyle).toHaveBeenCalledTimes(1)
  })

  it('routes native selection fallbacks to the requesting webContents', () => {
    const copy = vi.fn()
    const selectAll = vi.fn()
    const event = makeUIEvent()
    setTrustedUIRendererWebContentsId(17)
    fromWebContentsMock.mockReturnValue({ webContents: { copy, selectAll } })

    registerUIHandlers(makeStore() as never)

    expect(removeAllListenersMock).toHaveBeenCalledWith('ui:performNativeSelectionAction')
    const handler = getNativeSelectionActionHandler()
    handler?.(event, 'copy')
    handler?.(event, 'select-all')
    handler?.(event, 'invalid')

    expect(copy).toHaveBeenCalledOnce()
    expect(selectAll).toHaveBeenCalledOnce()
  })

  it('allows native selection fallback from the exact dashboard popout renderer', () => {
    const copy = vi.fn()
    const selectAll = vi.fn()
    const event = makeUIEvent({ id: 42 })
    const isDashboardPopoutRenderer = vi.fn((sender: unknown) => sender === event.sender)
    fromWebContentsMock.mockReturnValue({ webContents: { copy, selectAll } })

    registerUIHandlers(makeStore() as never, { isDashboardPopoutRenderer })

    const handler = getNativeSelectionActionHandler()
    handler?.(event, 'copy')
    handler?.(event, 'select-all')
    handler?.(makeUIEvent({ id: 43 }), 'copy')

    expect(isDashboardPopoutRenderer).toHaveBeenCalledWith(event.sender)
    expect(copy).toHaveBeenCalledOnce()
    expect(selectAll).toHaveBeenCalledOnce()
  })

  it('ignores native paste fallback from stale or browser senders', () => {
    const paste = vi.fn()
    const pasteAndMatchStyle = vi.fn()
    setTrustedUIRendererWebContentsId(17)
    fromWebContentsMock.mockReturnValue({ webContents: { paste, pasteAndMatchStyle } })

    registerUIHandlers(makeStore() as never)

    const nativePasteHandler = getNativePasteHandler()
    nativePasteHandler?.(makeUIEvent({ id: 42 }))
    nativePasteHandler?.(makeUIEvent({ getType: () => 'webview' }))

    expect(fromWebContentsMock).not.toHaveBeenCalled()
    expect(paste).not.toHaveBeenCalled()
    expect(pasteAndMatchStyle).not.toHaveBeenCalled()
  })

  it('ignores native paste fallback from destroyed senders', () => {
    const paste = vi.fn()
    const pasteAndMatchStyle = vi.fn()
    fromWebContentsMock.mockReturnValue({ webContents: { paste, pasteAndMatchStyle } })

    registerUIHandlers(makeStore() as never)

    const nativePasteHandler = getNativePasteHandler()
    nativePasteHandler?.(makeUIEvent({ isDestroyed: () => true }))

    expect(fromWebContentsMock).not.toHaveBeenCalled()
    expect(paste).not.toHaveBeenCalled()
    expect(pasteAndMatchStyle).not.toHaveBeenCalled()
  })

  it('rejects packaged file-url senders until the main window id is registered', () => {
    const paste = vi.fn()
    const pasteAndMatchStyle = vi.fn()
    const event = makeUIEvent()
    fromWebContentsMock.mockReturnValue({ webContents: { paste, pasteAndMatchStyle } })

    registerUIHandlers(makeStore() as never)

    getNativePasteHandler()?.(event)

    expect(fromWebContentsMock).not.toHaveBeenCalled()
    expect(paste).not.toHaveBeenCalled()
    expect(pasteAndMatchStyle).not.toHaveBeenCalled()
  })

  it('clears one trusted renderer id without clearing another window id', () => {
    const paste = vi.fn()
    const pasteAndMatchStyle = vi.fn()
    setTrustedUIRendererWebContentsId(17)
    setTrustedUIRendererWebContentsId(42)
    fromWebContentsMock.mockReturnValue({ webContents: { paste, pasteAndMatchStyle } })

    registerUIHandlers(makeStore() as never)

    getNativePasteHandler()?.(makeUIEvent())
    getNativePasteHandler()?.(makeUIEvent({ id: 42 }))

    expect(paste).toHaveBeenCalledTimes(2)

    clearTrustedUIRendererWebContentsId(42)
    fromWebContentsMock.mockClear()
    paste.mockClear()

    getNativePasteHandler()?.(makeUIEvent())
    getNativePasteHandler()?.(makeUIEvent({ id: 42 }))

    expect(fromWebContentsMock).toHaveBeenCalledTimes(1)
    expect(paste).toHaveBeenCalledTimes(1)
  })

  it('allows native paste fallback only from the configured dev renderer origin', () => {
    const paste = vi.fn()
    const pasteAndMatchStyle = vi.fn()
    const event = makeUIEvent({ getURL: () => 'http://localhost:5173/workspace' })
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173')
    fromWebContentsMock.mockReturnValue({ webContents: { paste, pasteAndMatchStyle } })

    registerUIHandlers(makeStore() as never)

    const nativePasteHandler = getNativePasteHandler()
    nativePasteHandler?.(event)

    expect(fromWebContentsMock).toHaveBeenCalledWith(event.sender)
    expect(paste).toHaveBeenCalledTimes(1)

    fromWebContentsMock.mockClear()
    paste.mockClear()
    nativePasteHandler?.(makeUIEvent({ getURL: () => 'http://127.0.0.1:5173/workspace' }))
    nativePasteHandler?.(makeUIEvent({ getURL: () => 'file:///orca/index.html' }))
    nativePasteHandler?.(makeUIEvent({ getURL: () => 'not a url' }))

    expect(fromWebContentsMock).not.toHaveBeenCalled()
    expect(paste).not.toHaveBeenCalled()
    expect(pasteAndMatchStyle).not.toHaveBeenCalled()
  })
})

describe('UI IPC per-window routing', () => {
  beforeEach(() => {
    handleMock.mockReset()
    getAllWindowsMock.mockReset()
    getAllWindowsMock.mockReturnValue([])
    _resetWindowViewStateRegistryForTests()
  })

  function makeWindowedStore() {
    let ui: Record<string, unknown> = {
      filterRepoIds: ['persisted'],
      filterGroupIds: [],
      uiZoomLevel: 0
    }
    const listeners: ((ui: unknown) => void)[] = []
    return {
      listeners,
      onUIChanged: vi.fn((listener: (ui: unknown) => void) => {
        listeners.push(listener)
        return () => {}
      }),
      getUI: vi.fn(() => ui),
      updateUI: vi.fn((updates: Record<string, unknown>) => {
        ui = { ...ui, ...updates }
      }),
      recordFeatureInteraction: vi.fn()
    }
  }

  function getHandler(channel: string): ((event: unknown, args?: unknown) => unknown) | undefined {
    return handleMock.mock.calls.find(([name]) => name === channel)?.[1]
  }

  it('answers ui:get with the sender window own view state', () => {
    const store = makeWindowedStore()
    bindWindowIdToWebContents(17, 'win-a')
    registerUIHandlers(store as never)

    const first = getHandler('ui:get')?.({ sender: { id: 17 } }) as { filterRepoIds: string[] }
    getHandler('ui:set')?.({ sender: { id: 17 } }, { filterRepoIds: ['perc'] })
    const second = getHandler('ui:get')?.({ sender: { id: 17 } }) as { filterRepoIds: string[] }

    expect(first.filterRepoIds).toEqual(['persisted'])
    expect(second.filterRepoIds).toEqual(['perc'])
    // Why: with no focused/last-active window registered, the sender is a background window.
    expect(store.updateUI).not.toHaveBeenCalled()
  })

  it('routes ui:set global keys to the store for any sender', () => {
    const store = makeWindowedStore()
    bindWindowIdToWebContents(17, 'win-a')
    registerUIHandlers(store as never)

    getHandler('ui:set')?.({ sender: { id: 17 } }, { uiZoomLevel: 2, filterGroupIds: ['g'] })
    getHandler('ui:set')?.({ sender: { id: 99 } }, { filterRepoIds: ['popout'] })

    expect(store.updateUI).toHaveBeenNthCalledWith(1, { uiZoomLevel: 2 })
    expect(store.updateUI).toHaveBeenNthCalledWith(2, { filterRepoIds: ['popout'] })
  })

  it('broadcasts ui:stateChanged with each window own filter overlaid', () => {
    const store = makeWindowedStore()
    const sendA = vi.fn()
    const sendB = vi.fn()
    getAllWindowsMock.mockReturnValue([
      { isDestroyed: () => false, webContents: { id: 17, send: sendA } },
      { isDestroyed: () => false, webContents: { id: 18, send: sendB } }
    ] as never)
    bindWindowIdToWebContents(17, 'win-a')
    bindWindowIdToWebContents(18, 'win-b')
    registerUIHandlers(store as never)
    getHandler('ui:get')?.({ sender: { id: 17 } })
    getHandler('ui:get')?.({ sender: { id: 18 } })
    getHandler('ui:set')?.({ sender: { id: 17 } }, { filterRepoIds: ['perc'] })

    store.listeners[0]?.({ filterRepoIds: ['from-profile'], uiZoomLevel: 3 })

    expect(sendA).toHaveBeenCalledWith('ui:stateChanged', {
      filterRepoIds: ['perc'],
      filterGroupIds: [],
      uiZoomLevel: 3
    })
    expect(sendB).toHaveBeenCalledWith('ui:stateChanged', {
      filterRepoIds: ['persisted'],
      filterGroupIds: [],
      uiZoomLevel: 3
    })
  })
})
