import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () =>
  (await import('./createMainWindow-test-harness')).electronModuleMock()
)
vi.mock('@electron-toolkit/utils', async () =>
  (await import('./createMainWindow-test-harness')).electronToolkitUtilsMock()
)
vi.mock('./macos-tahoe-release', async () =>
  (await import('./createMainWindow-test-harness')).macosTahoeReleaseMock()
)
vi.mock('../app-icon', async () => (await import('./createMainWindow-test-harness')).appIconMock())
vi.mock('../browser/browser-manager', async () =>
  (await import('./createMainWindow-test-harness')).browserManagerMock()
)
vi.mock('./main-window-registry', async () =>
  (await import('./createMainWindow-test-harness')).mainWindowRegistryMock()
)

import {
  closeWindowAfterConfirmation,
  createMainWindow,
  requestWindowCloseForQuit
} from './createMainWindow'
import { ipcMain } from 'electron'
import { resetExpectedTeardownStateForTest } from '../crash-reporting/expected-teardown-state'
import { browserWindowMock, resetMainWindowMocks } from './createMainWindow-test-harness'

type Handlers = Record<string, (...args: any[]) => void>

function setupWindow(
  overrides: { isCrashed?: () => boolean; webContentsDestroyed?: boolean } = {}
): {
  handlers: Handlers
  webContents: Record<string, unknown>
  instance: Record<string, unknown>
} {
  const handlers: Handlers = {}
  const webContents = {
    id: 42,
    on: vi.fn((event: string, handler: (...args: any[]) => void) => {
      handlers[event] = handler
    }),
    setZoomLevel: vi.fn(),
    setBackgroundThrottling: vi.fn(),
    invalidate: vi.fn(),
    setWindowOpenHandler: vi.fn(),
    send: vi.fn(),
    isDestroyed: vi.fn(() => overrides.webContentsDestroyed === true),
    isCrashed: vi.fn(overrides.isCrashed ?? (() => false))
  }
  const instance = {
    webContents,
    on: vi.fn((event: string, handler: (...args: any[]) => void) => {
      handlers[event] = handler
    }),
    close: vi.fn(),
    isDestroyed: vi.fn(() => false),
    isMaximized: vi.fn(() => false),
    isFullScreen: vi.fn(() => false),
    getSize: vi.fn(() => [1200, 800]),
    setSize: vi.fn(),
    maximize: vi.fn(),
    show: vi.fn(),
    loadFile: vi.fn(),
    loadURL: vi.fn()
  }
  browserWindowMock.mockImplementation(function () {
    return instance
  })
  return { handlers, webContents, instance }
}

function lastListener(channel: string): (...args: any[]) => void {
  return vi.mocked(ipcMain.on).mock.calls.findLast(([name]) => name === channel)?.[1] as (
    ...args: any[]
  ) => void
}

describe('createMainWindow multi-window quit confirmation', () => {
  beforeEach(() => {
    resetMainWindowMocks()
    resetExpectedTeardownStateForTest()
    vi.useRealTimers()
  })

  it('collects quit confirmations without closing the window immediately', () => {
    const { webContents, instance } = setupWindow()
    const onQuitWindowCloseConfirmed = vi.fn()

    const win = createMainWindow(null, {
      deferLoad: true,
      getIsQuitting: () => true,
      isQuitConfirmationCollecting: () => true,
      onQuitWindowCloseConfirmed
    })

    lastListener('window:confirm-close')({ sender: webContents })

    expect(onQuitWindowCloseConfirmed).toHaveBeenCalledWith(win)
    expect(instance.close).not.toHaveBeenCalled()

    closeWindowAfterConfirmation(win)

    expect(instance.close).toHaveBeenCalledTimes(1)
  })

  it('ignores a confirmation that belongs to another window renderer', () => {
    const { instance } = setupWindow()
    const onQuitWindowCloseConfirmed = vi.fn()

    createMainWindow(null, {
      deferLoad: true,
      getIsQuitting: () => true,
      isQuitConfirmationCollecting: () => true,
      onQuitWindowCloseConfirmed
    })

    lastListener('window:confirm-close')({ sender: { id: 43 } })

    expect(onQuitWindowCloseConfirmed).not.toHaveBeenCalled()
    expect(instance.close).not.toHaveBeenCalled()
  })

  it('reports a renderer close cancellation as an aborted quit', () => {
    const { webContents } = setupWindow()
    const onQuitAborted = vi.fn()

    createMainWindow(null, {
      deferLoad: true,
      getIsQuitting: () => true,
      isQuitConfirmationCollecting: () => true,
      onQuitAborted
    })

    lastListener('window:cancel-close')({ sender: webContents })

    expect(onQuitAborted).toHaveBeenCalledTimes(1)
  })

  it('ignores stale quit confirmations after the app quit transaction aborts', () => {
    const { handlers, webContents, instance } = setupWindow()
    let isQuitting = true

    createMainWindow(null, {
      deferLoad: true,
      getIsQuitting: () => isQuitting,
      isQuitConfirmationCollecting: () => false
    })
    handlers.close({ preventDefault: vi.fn() } as never)
    isQuitting = false

    lastListener('window:confirm-close')({ sender: webContents })

    expect(instance.close).not.toHaveBeenCalled()
  })

  it('uses the app-quit close request latch to ignore stale confirmations', () => {
    const { webContents, instance } = setupWindow()
    let isQuitting = true

    const win = createMainWindow(null, {
      deferLoad: true,
      getIsQuitting: () => isQuitting,
      isQuitConfirmationCollecting: () => false
    })

    expect(requestWindowCloseForQuit(win)).toBe(true)
    expect(webContents.send).toHaveBeenCalledWith('window:close-requested', {
      isQuitting: true,
      requestId: expect.any(Number)
    })

    isQuitting = false
    lastListener('window:confirm-close')({ sender: webContents })

    expect(instance.close).not.toHaveBeenCalled()
  })

  it('closes after a single-window app quit confirmation while quit is still active', () => {
    const { webContents, instance } = setupWindow()

    const win = createMainWindow(null, {
      deferLoad: true,
      getIsQuitting: () => true,
      isQuitConfirmationCollecting: () => false
    })

    expect(requestWindowCloseForQuit(win)).toBe(true)

    lastListener('window:confirm-close')({ sender: webContents })

    expect(instance.close).toHaveBeenCalledTimes(1)
  })

  it('does not request app-quit confirmation from a crashed renderer', () => {
    const { webContents } = setupWindow({ isCrashed: () => true })

    const win = createMainWindow(null, { deferLoad: true })

    expect(requestWindowCloseForQuit(win)).toBe(false)
    expect(webContents.send).not.toHaveBeenCalledWith('window:close-requested', expect.anything())
  })

  it('does not inspect crashed state when the renderer is already destroyed', () => {
    const { webContents } = setupWindow({
      webContentsDestroyed: true,
      isCrashed: () => {
        throw new Error('Object has been destroyed')
      }
    })

    const win = createMainWindow(null, { deferLoad: true })
    vi.mocked(webContents.isCrashed as ReturnType<typeof vi.fn>).mockClear()

    expect(() => requestWindowCloseForQuit(win)).not.toThrow()
    expect(requestWindowCloseForQuit(win)).toBe(false)
    expect(webContents.isCrashed).not.toHaveBeenCalled()
    expect(webContents.send).not.toHaveBeenCalledWith('window:close-requested', expect.anything())
  })
})
