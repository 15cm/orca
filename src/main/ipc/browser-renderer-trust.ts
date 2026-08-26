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
