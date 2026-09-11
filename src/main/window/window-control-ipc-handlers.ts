import { ipcMain, Menu, type BrowserWindow } from 'electron'
import { getMainWindowForWebContents } from './main-window-registry'
import { claimWindowControlRegistration } from './window-control-registration-latch'

const hideToTrayRequestByWindow = new WeakMap<BrowserWindow, () => boolean>()

export function setHideToTrayRequest(window: BrowserWindow, request: () => boolean): void {
  hideToTrayRequestByWindow.set(window, request)
}

export function clearHideToTrayRequest(window: BrowserWindow): void {
  hideToTrayRequestByWindow.delete(window)
}

// Why: renderer-drawn window controls on Windows/Linux replicate the native
// title-bar buttons hidden by custom chrome. Registered once and routed by
// sender so additional top-level windows cannot operate on whichever window
// registered last.
export function registerWindowControlIpcHandlers(): void {
  if (!claimWindowControlRegistration()) {
    return
  }

  ipcMain.on('window:minimize', (event) => {
    getMainWindowForWebContents(event.sender)?.minimize()
  })
  ipcMain.on('window:maximize', (event) => {
    const window = getMainWindowForWebContents(event.sender)
    if (!window) {
      return
    }
    if (window.isMaximized()) {
      window.unmaximize()
    } else {
      window.maximize()
    }
  })
  // Why: mainWindow.close() from an IPC handler on Windows can make 'close'
  // misfire, so send window:close-requested directly. The minimize-to-tray
  // guard must run here too — the renderer-drawn X routes here, not through
  // the native close event.
  ipcMain.on('window:request-close', (event) => {
    const window = getMainWindowForWebContents(event.sender)
    if (!window) {
      return
    }
    if (hideToTrayRequestByWindow.get(window)?.() === true) {
      return
    }
    if (!window.isDestroyed()) {
      window.webContents.send('window:close-requested', { isQuitting: false })
    }
  })
  // Why: renderer-drawn title-bar ··· menu button replicates the Alt-key reveal
  // autoHideMenuBar provides (Windows/Linux).
  ipcMain.on('menu:popup', (event) => {
    const window = getMainWindowForWebContents(event.sender)
    if (window) {
      Menu.getApplicationMenu()?.popup({ window })
    }
  })
  // Why: WindowControls mounts after window:maximize-changed already fired, so
  // expose a synchronous getter to init its icon.
  ipcMain.handle('window:isMaximized', (event): boolean => {
    return getMainWindowForWebContents(event.sender)?.isMaximized() ?? false
  })
}
