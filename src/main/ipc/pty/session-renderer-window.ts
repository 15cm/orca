import type { BrowserWindow } from 'electron'
import { getLastActiveMainWindow } from '../../window/main-window-registry'

function isLiveRendererWindow(window: BrowserWindow | null | undefined): window is BrowserWindow {
  if (!window || window.isDestroyed()) {
    return false
  }
  const contents = window.webContents
  return !(typeof contents?.isDestroyed === 'function' && contents.isDestroyed())
}

/**
 * The window this session may deliver to right now, or null when there is no renderer at all.
 *
 * Why not `session.mainWindow.isDestroyed()` on its own: the session captures whichever window
 * registered it and nothing ever reassigns that reference, so closing that one window discarded
 * PTY output for every other live window, permanently (a new registration was the only cure).
 *
 * Why `headless` is a flag and not inferred from the registry: `orca serve` encodes "no renderer"
 * as a fake destroyed window, so a registry fallback would make a UI-less server start delivering
 * bytes — and charging renderer credit for them. Stale reference and no renderer are not the same
 * fact and must not share an encoding.
 */
export function resolveSessionRendererWindow(session: {
  mainWindow: BrowserWindow
  headless: boolean
}): BrowserWindow | null {
  if (isLiveRendererWindow(session.mainWindow)) {
    return session.mainWindow
  }
  if (session.headless) {
    return null
  }
  const lastActive = getLastActiveMainWindow()
  return isLiveRendererWindow(lastActive) ? lastActive : null
}
