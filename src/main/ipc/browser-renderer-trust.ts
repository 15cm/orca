import { getMainWindowForWebContents } from '../window/main-window-registry'

const trustedBrowserRendererWebContentsIds = new Set<number>()
let explicitBrowserRendererTrustInitialized = false

export function setTrustedBrowserRendererWebContentsId(webContentsId: number | null): void {
  if (webContentsId === null) {
    trustedBrowserRendererWebContentsIds.clear()
    explicitBrowserRendererTrustInitialized = false
    return
  }
  explicitBrowserRendererTrustInitialized = true
  trustedBrowserRendererWebContentsIds.add(webContentsId)
}

export function removeTrustedBrowserRendererWebContentsId(webContentsId: number): void {
  trustedBrowserRendererWebContentsIds.delete(webContentsId)
}

export function isTrustedBrowserRenderer(sender: Electron.WebContents): boolean {
  if (sender.isDestroyed() || sender.getType() !== 'window') {
    return false
  }
  // Why: every main window registers its own renderer, so trust is a set; the
  // registry check rejects ids left over from a window that is already gone.
  if (explicitBrowserRendererTrustInitialized) {
    return (
      trustedBrowserRendererWebContentsIds.has(sender.id) &&
      getMainWindowForWebContents(sender) !== null
    )
  }

  const senderUrl = sender.getURL()
  if (process.env.ELECTRON_RENDERER_URL) {
    try {
      return new URL(senderUrl).origin === new URL(process.env.ELECTRON_RENDERER_URL).origin
    } catch {
      return false
    }
  }

  return senderUrl.startsWith('file://')
}
