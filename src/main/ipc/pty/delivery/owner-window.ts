import type { BrowserWindow, WebContents } from 'electron'
import { getMainWindowForWebContents } from '../../../window/main-window-registry'
import { getRuntimeDesktopSurface } from '../../../runtime/runtime-desktop-surface'
import type { PtyIpcSession } from '../session'

// Why: a PTY belongs to the window whose renderer published the pane that owns it.
// Falling back to the session's resolved renderer window keeps single-window behavior
// unchanged and covers PTYs that have not reached a published graph yet — without pinning
// delivery to a registering window that may since have closed.
export function getPtyRendererWindow(session: PtyIpcSession, id: string): BrowserWindow | null {
  const ownerWindowId = session.runtime?.resolveOwnerWindowIdForPtyId?.(id) ?? null
  const owner =
    ownerWindowId === null ? null : getRuntimeDesktopSurface().findWindowById(ownerWindowId)
  const target = owner ?? session.resolveRendererWindow()
  if (!target || target.isDestroyed()) {
    return null
  }
  const webContentsDestroyed =
    typeof target.webContents.isDestroyed === 'function' && target.webContents.isDestroyed()
  return webContentsDestroyed ? null : target
}

// Why: after a hand-off the previous owner's late cumulative ACKs describe bytes the new owner
// never saw; crediting them would open the in-flight window on bytes still unparsed there.
export function isPtyOwnerWindowSender(
  session: PtyIpcSession,
  sender: WebContents,
  id: string
): boolean {
  const ownerWindowId = session.runtime?.resolveOwnerWindowIdForPtyId?.(id) ?? null
  if (ownerWindowId === null) {
    return true
  }
  return getMainWindowForWebContents(sender)?.id === ownerWindowId
}
