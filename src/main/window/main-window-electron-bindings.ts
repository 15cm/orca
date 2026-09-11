import type { BaseWindow, BrowserWindow, WebContents } from 'electron'

/**
 * The three Electron lookups the main-window registry cannot do from its own bookkeeping.
 *
 * Why injected rather than imported: the registry is reachable from the Orca runtime's
 * import graph, and that graph must stay bootable on plain Node (see
 * docs/design/node-only-runtime-backend.html). The desktop installs the real Electron
 * lookups at startup; a headless host installs nothing and every lookup answers "no
 * window", which is the truth there.
 */
export type MainWindowElectronBindings = {
  getFocusedWindow(): BrowserWindow | null
  fromWebContents(webContents: WebContents): BrowserWindow | null
  isBrowserWindow(window: BaseWindow | null | undefined): window is BrowserWindow
}

const noopBindings: MainWindowElectronBindings = {
  getFocusedWindow: () => null,
  fromWebContents: () => null,
  isBrowserWindow: (_window): _window is BrowserWindow => false
}

let current: MainWindowElectronBindings = noopBindings

export function setMainWindowElectronBindings(bindings: MainWindowElectronBindings | null): void {
  current = bindings ?? noopBindings
}

export function getMainWindowElectronBindings(): MainWindowElectronBindings {
  return current
}
