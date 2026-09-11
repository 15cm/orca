import type { BrowserWindow } from 'electron'
import { getRuntimeDesktopSurface } from '../../../runtime/runtime-desktop-surface'
import type { PtyIpcSession } from '../session'

// Why: a PTY belongs to the window whose renderer published the pane that owns it.
// Falling back to the registering window keeps single-window behavior unchanged and
// covers PTYs that have not reached a published graph yet.
export function getPtyRendererWindow(session: PtyIpcSession, id: string): BrowserWindow | null {
  const ownerWindowId = session.runtime?.resolveOwnerWindowIdForPtyId?.(id) ?? null
  const owner =
    ownerWindowId === null ? null : getRuntimeDesktopSurface().findWindowById(ownerWindowId)
  const target = owner ?? session.mainWindow
  if (target.isDestroyed()) {
    return null
  }
  const webContentsDestroyed =
    typeof target.webContents.isDestroyed === 'function' && target.webContents.isDestroyed()
  return webContentsDestroyed ? null : target
}
