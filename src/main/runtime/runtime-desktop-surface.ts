import type { BrowserWindow, IpcMainEvent } from 'electron'

/**
 * The desktop facilities `OrcaRuntimeService` uses, which a Node host does not have.
 *
 * Three sites, all optional by nature: a native notification toast, a lookup of the
 * authoritative renderer window, and one ipcMain channel used only by the
 * renderer-backed tab-create fallback. With no renderer that fallback is unreachable —
 * `createTerminal` already takes the background spawn branch when there is no
 * authoritative window (#10333) — so a Node host needs none of them.
 *
 * Defaults are inert rather than throwing, for the same reason as the PTY bindings: a
 * host with no desktop legitimately has nothing here, and that is not a downgrade.
 * Where absence IS user-visible — a notification that would have been shown — the
 * runtime already routes to paired clients, which is the better destination anyway.
 */

export type RuntimeDesktopSurface = {
  /** Show a native notification. Returns false when the host cannot, so callers can say so. */
  showNotification(input: { title: string; body: string }): boolean
  /** The renderer window with this id, or null when there is no desktop. */
  findWindowById(id: number): BrowserWindow | null
  /** The preferred renderer window for commands without an owning tab. */
  getPreferredRendererWindow?(): BrowserWindow | null
  /** Resolve a browser page's renderer window when graph ownership is unavailable. */
  findBrowserPageRendererWindow?(browserPageId: string): BrowserWindow | null
  /** Send a renderer event to every registered desktop window. */
  broadcastMainWindows(channel: string, ...args: unknown[]): void
  /** Number of registered desktop windows. */
  getMainWindowCount(): number
  /** Send a renderer event to one desktop window. */
  sendToMainWindow(window: BrowserWindow, channel: string, ...args: unknown[]): void
  onIpc(channel: string, listener: (event: IpcMainEvent, ...args: never[]) => void): void
  removeIpcListener(channel: string, listener: (...args: never[]) => void): void
}

const inertDesktopSurface: RuntimeDesktopSurface = {
  showNotification: () => false,
  findWindowById: () => null,
  broadcastMainWindows: () => {},
  getMainWindowCount: () => 0,
  sendToMainWindow: (window, channel, ...args) => {
    if (!window.isDestroyed()) {
      window.webContents.send(channel, ...args)
    }
  },
  onIpc: () => {},
  removeIpcListener: () => {}
}

let current: RuntimeDesktopSurface = inertDesktopSurface

export function setRuntimeDesktopSurface(surface: RuntimeDesktopSurface | null): void {
  current = surface ?? inertDesktopSurface
}

export function getRuntimeDesktopSurface(): RuntimeDesktopSurface {
  return current
}
