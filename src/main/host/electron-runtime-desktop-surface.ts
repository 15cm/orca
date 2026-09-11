import { BrowserWindow, ipcMain, Notification, powerMonitor, webContents } from 'electron'
import { browserManager } from '../browser/browser-manager'
import { readDesktopAwayState } from '../notifications/desktop-away-state'
import type { RuntimeDesktopSurface } from '../runtime/runtime-desktop-surface'
import {
  getFocusedOrLastActiveMainWindow,
  getMainWindowForWebContents,
  getMainWindows
} from '../window/main-window-registry'

/** The desktop implementation of the runtime's optional desktop facilities. */
export const electronRuntimeDesktopSurface: RuntimeDesktopSurface = {
  isAwayForMobileNotifications: () => readDesktopAwayState(powerMonitor),
  showNotification: ({ title, body }) => {
    if (!Notification.isSupported()) {
      return false
    }
    new Notification({ title, body }).show()
    return true
  },
  findWindowById: (id) => BrowserWindow.fromId(id),
  findFocusedOrLastActiveWindow: () => getFocusedOrLastActiveMainWindow(),
  countLiveWindows: () => getMainWindows().length,
  findWindowForBrowserPage: (browserPageId) => {
    const id = browserManager.getRendererWebContentsId(browserPageId)
    const renderer = id === null ? null : webContents.fromId(id)
    return renderer ? getMainWindowForWebContents(renderer) : null
  },
  onIpc: (channel, listener) => {
    ipcMain.on(channel, listener as Parameters<typeof ipcMain.on>[1])
  },
  removeIpcListener: (channel, listener) => {
    ipcMain.removeListener(channel, listener as Parameters<typeof ipcMain.removeListener>[1])
  }
}
