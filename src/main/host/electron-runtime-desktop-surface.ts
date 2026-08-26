import { BrowserWindow, ipcMain, Notification } from 'electron'
import type { RuntimeDesktopSurface } from '../runtime/runtime-desktop-surface'
import { browserManager } from '../browser/browser-manager'
import { webContents } from 'electron'
import {
  broadcastToMainWindows,
  getFocusedOrLastActiveMainWindow,
  getMainWindowForWebContents,
  getMainWindows,
  sendToWindow
} from '../window/main-window-registry'

/** The desktop implementation of the runtime's optional desktop facilities. */
export const electronRuntimeDesktopSurface: RuntimeDesktopSurface = {
  showNotification: ({ title, body }) => {
    if (!Notification.isSupported()) {
      return false
    }
    new Notification({ title, body }).show()
    return true
  },
  findWindowById: (id) => BrowserWindow.fromId(id),
  getPreferredRendererWindow: () => getFocusedOrLastActiveMainWindow(),
  broadcastMainWindows: (channel, ...args) => broadcastToMainWindows(channel, ...args),
  getMainWindowCount: () => getMainWindows().length,
  sendToMainWindow: (window, channel, ...args) => sendToWindow(window, channel, ...args),
  findBrowserPageRendererWindow: (browserPageId) => {
    const rendererWebContentsId = browserManager.getRendererWebContentsId(browserPageId)
    const renderer =
      rendererWebContentsId === null ? null : webContents.fromId(rendererWebContentsId)
    return renderer ? getMainWindowForWebContents(renderer) : null
  },
  onIpc: (channel, listener) => {
    ipcMain.on(channel, listener as Parameters<typeof ipcMain.on>[1])
  },
  removeIpcListener: (channel, listener) => {
    ipcMain.removeListener(channel, listener as Parameters<typeof ipcMain.removeListener>[1])
  }
}
