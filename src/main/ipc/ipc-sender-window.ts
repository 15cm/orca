import type { BrowserWindow } from 'electron'
import { getMainWindowForWebContents } from '../window/main-window-registry'

/** The window that sent this IPC call, falling back to the registering window.
 *  Why: several handlers are also reachable from tests and defensive callers with
 *  no Electron sender, so the legacy main-window fallback must stay. */
export function resolveIpcSenderWindow(
  event: { sender?: Electron.WebContents } | null | undefined,
  fallbackWindow: BrowserWindow
): BrowserWindow {
  return event?.sender
    ? (getMainWindowForWebContents(event.sender) ?? fallbackWindow)
    : fallbackWindow
}
