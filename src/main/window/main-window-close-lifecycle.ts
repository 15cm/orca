import { ipcMain, Notification, type BrowserWindow } from 'electron'
import { QUIT_RENDERER_ACK_TIMEOUT_MS } from '../../shared/quit-teardown-deadline'
import { translateMain } from '../i18n/main-i18n'
import type { Store } from '../persistence'
import { resolveWindowCloseAction } from './window-close-decision'
import type { CreateMainWindowOptions } from './main-window-contracts'
import type { MainWindowFocusLifecycle } from './main-window-focus-lifecycle'
import type { MainWindowStateLifecycle } from './main-window-state-lifecycle'
import { syncTrafficLightPosition } from './main-window-visual-lifecycle'
import {
  clearHideToTrayRequest,
  registerWindowControlIpcHandlers,
  setCloseRequest,
  setHideToTrayRequest
} from './window-control-ipc-handlers'

export const WINDOW_QUIT_RENDERER_ACK_TIMEOUT_MS = QUIT_RENDERER_ACK_TIMEOUT_MS
const confirmedCloseByWindow = new WeakMap<BrowserWindow, () => void>()
const quitRequestByWindow = new WeakMap<BrowserWindow, () => boolean>()
const forceCloseByWindow = new WeakMap<BrowserWindow, () => void>()

export function closeWindowAfterConfirmation(window: BrowserWindow): void {
  forceCloseByWindow.get(window)?.()
}

export function requestWindowCloseForQuit(window: BrowserWindow): boolean {
  return quitRequestByWindow.get(window)?.() ?? false
}

export function installMainWindowCloseLifecycle(args: {
  focus: MainWindowFocusLifecycle
  mainWindow: BrowserWindow
  opts?: CreateMainWindowOptions
  rendererWebContentsId: number
  state: MainWindowStateLifecycle
  store: Store | null
}): { dispose: () => void } {
  const { focus, mainWindow, opts, rendererWebContentsId, state, store } = args
  registerWindowControlIpcHandlers()
  // Intercept close so the renderer can confirm killing running-process terminals (replies window:confirm-close to proceed).
  let windowCloseConfirmed = false
  let closeConfirmationActive = false
  let quitConfirmationActive = false
  const confirmCloseChannel = 'window:confirm-close'
  const closeRequestReceivedChannel = 'window:close-request-received'
  let closeRequestSequence = 0
  let quitRendererAckRequestId: number | null = null
  let quitRendererAckTimer: ReturnType<typeof setTimeout> | null = null
  const clearQuitRendererAckTimer = (): void => {
    quitRendererAckRequestId = null
    if (quitRendererAckTimer) {
      clearTimeout(quitRendererAckTimer)
      quitRendererAckTimer = null
    }
  }
  const armQuitRendererAckTimer = (requestId: number): void => {
    quitRendererAckRequestId = requestId
    if (quitRendererAckTimer) {
      return
    }
    // Why: will-quit cannot run until the renderer-backed window closes; an
    // already-frozen renderer otherwise makes Force Quit the only escape.
    quitRendererAckTimer = setTimeout(() => {
      quitRendererAckTimer = null
      quitRendererAckRequestId = null
      if (mainWindow.isDestroyed()) {
        return
      }
      console.warn('[window] Renderer did not acknowledge quit; destroying unresponsive window')
      state.freezeBoundsOnQuit()
      mainWindow.destroy()
    }, WINDOW_QUIT_RENDERER_ACK_TIMEOUT_MS)
    quitRendererAckTimer.unref?.()
  }
  const onCloseRequestReceived = (event: Electron.IpcMainEvent, requestId: number): void => {
    if (event.sender.id === rendererWebContentsId && requestId === quitRendererAckRequestId) {
      clearQuitRendererAckTimer()
    }
  }

  // Windows minimize-to-tray: hide instead of close when enabled; returns true when it hid so callers skip their close path.
  const hideToTrayIfEnabled = (): boolean => {
    const isRendererCrashed = mainWindow.webContents.isCrashed?.() ?? false
    if (
      process.platform !== 'win32' ||
      focus.isRendererProcessGone() ||
      isRendererCrashed ||
      opts?.getIsQuitting?.() === true ||
      store?.getSettings().minimizeToTrayOnClose !== true
    ) {
      return false
    }
    mainWindow.hide()
    // Why: notify once that closing only hid the window; the persisted flag stops it repeating on every later minimize.
    if (store.getUI().trayMinimizeNoticeShown !== true) {
      try {
        new Notification({
          title: 'Orca',
          body: translateMain(
            'tray.minimizeNotice.body',
            'Orca is still running in the system tray'
          )
        }).show()
      } catch {
        // Notification is best-effort — never block hiding the window.
      }
      store.updateUI({ trayMinimizeNoticeShown: true })
    }
    return true
  }
  setHideToTrayRequest(mainWindow, hideToTrayIfEnabled)
  setCloseRequest(mainWindow, () => {
    closeConfirmationActive = true
  })

  mainWindow.on('close', (e) => {
    // Why: Alt+F4/programmatic closes hit the native event; apply the same minimize-to-tray guard the renderer-drawn X uses.
    if (!windowCloseConfirmed && hideToTrayIfEnabled()) {
      e.preventDefault()
      return
    }
    const isRendererCrashed = mainWindow.webContents.isCrashed?.() ?? false
    // Why: only a gone/crashed renderer (can't answer) may bypass close confirmation; a hung-but-alive one still must (#5787).
    const closeAction = resolveWindowCloseAction({
      windowCloseConfirmed,
      rendererProcessGone: focus.isRendererProcessGone(),
      isRendererCrashed
    })
    if (closeAction !== 'request-confirmation') {
      // allow-confirmed: renderer already replied and re-entered close().
      // bypass-gone: a gone renderer can't answer window:close-requested, so let OS close complete rather than trap a blank window.
      if (closeAction === 'allow-confirmed') {
        windowCloseConfirmed = false
      }
      // Why: window teardown emits resize/move/unmaximize; freeze bounds persistence so they can't clobber saved size (v1.3.26-rc2).
      state.freezeBoundsOnQuit()
      return
    }
    e.preventDefault()
    const isQuitting = opts?.getIsQuitting?.() ?? false
    closeConfirmationActive = true
    const requestId = ++closeRequestSequence
    if (isQuitting) {
      quitConfirmationActive = true
      armQuitRendererAckTimer(requestId)
    }
    // Why: renderer owns the close decision; the always-mounted App root subscription lets even pre-workspace states reply (#5144).
    mainWindow.webContents.send('window:close-requested', {
      isQuitting,
      requestId
    })
  })
  mainWindow.webContents.on('will-prevent-unload', () => {
    // Why: a prevented beforeunload cancels the quit; release the bounds-persistence freeze so later resizing still saves.
    state.resumeBoundsPersistence()
    closeConfirmationActive = false
    quitConfirmationActive = false
    clearQuitRendererAckTimer()
    opts?.onQuitAborted?.()
    mainWindow.webContents.send('window:unload-prevented')
  })

  const onConfirmClose = (event: Electron.IpcMainEvent): void => {
    if (event.sender.id !== rendererWebContentsId) {
      return
    }
    if (opts?.isQuitConfirmationCollecting?.()) {
      opts.onQuitWindowCloseConfirmed?.(mainWindow)
      return
    }
    if (!closeConfirmationActive) {
      return
    }
    // A quit confirmation must not close a window after the app-wide quit transaction aborts.
    if (quitConfirmationActive !== (opts?.getIsQuitting?.() === true)) {
      return
    }
    clearQuitRendererAckTimer()
    closeConfirmationActive = false
    quitConfirmationActive = false
    windowCloseConfirmed = true
    if (!mainWindow.isDestroyed()) {
      mainWindow.close()
    }
  }
  confirmedCloseByWindow.set(mainWindow, () => {
    windowCloseConfirmed = true
    if (!mainWindow.isDestroyed()) {
      mainWindow.close()
    }
  })
  forceCloseByWindow.set(mainWindow, () => {
    windowCloseConfirmed = true
    if (!mainWindow.isDestroyed()) {
      mainWindow.close()
    }
  })
  quitRequestByWindow.set(mainWindow, () => {
    if (
      mainWindow.isDestroyed() ||
      mainWindow.webContents.isDestroyed?.() === true ||
      mainWindow.webContents.isCrashed?.() === true
    ) {
      return false
    }
    const requestId = ++closeRequestSequence
    closeConfirmationActive = true
    quitConfirmationActive = true
    armQuitRendererAckTimer(requestId)
    mainWindow.webContents.send('window:close-requested', { isQuitting: true, requestId })
    return true
  })
  const trafficLightChannel = 'ui:sync-traffic-lights'
  const onSyncTrafficLights = (event: Electron.IpcMainEvent, zoomFactor: number): void => {
    if (event.sender.id !== rendererWebContentsId) {
      return
    }
    syncTrafficLightPosition(mainWindow, zoomFactor)
  }
  ipcMain.on(trafficLightChannel, onSyncTrafficLights)

  ipcMain.on(confirmCloseChannel, onConfirmClose)
  const onCancelClose = (event: Electron.IpcMainEvent): void => {
    if (event.sender.id !== rendererWebContentsId) {
      return
    }
    closeConfirmationActive = false
    quitConfirmationActive = false
    opts?.onQuitAborted?.()
  }
  ipcMain.on('window:cancel-close', onCancelClose)
  ipcMain.on(closeRequestReceivedChannel, onCloseRequestReceived)

  const dispose = (): void => {
    clearQuitRendererAckTimer()
    ipcMain.removeListener(trafficLightChannel, onSyncTrafficLights)
    ipcMain.removeListener(confirmCloseChannel, onConfirmClose)
    confirmedCloseByWindow.delete(mainWindow)
    quitRequestByWindow.delete(mainWindow)
    forceCloseByWindow.delete(mainWindow)
    clearHideToTrayRequest(mainWindow)
    ipcMain.removeListener('window:cancel-close', onCancelClose)
    ipcMain.removeListener(closeRequestReceivedChannel, onCloseRequestReceived)
  }
  return { dispose }
}
