import type { BrowserWindow } from 'electron'
import { getFocusedOrLastActiveMainWindow, getMainWindowById } from './main-window-registry'

export type RuntimeWindowNotifier = {
  window: BrowserWindow
  send: (channel: string, ...values: unknown[]) => boolean
}

// Why: the runtime notifier is installed once but must reach whichever window owns
// the tab/pane an event is about, so senders are kept per window instead of closed over one.
const notifiersByWindowId = new Map<number, RuntimeWindowNotifier>()

export function registerRuntimeWindowNotifier(notifier: RuntimeWindowNotifier): void {
  notifiersByWindowId.set(notifier.window.id, notifier)
}

export function unregisterRuntimeWindowNotifier(windowId: number): void {
  notifiersByWindowId.delete(windowId)
}

export function hasRuntimeWindowNotifiers(): boolean {
  return notifiersByWindowId.size > 0
}

/** The notifier for the window the user is currently working in. */
export function getPreferredRuntimeWindowNotifier(): RuntimeWindowNotifier | null {
  const preferred = getFocusedOrLastActiveMainWindow()
  const preferredNotifier = preferred ? notifiersByWindowId.get(preferred.id) : undefined
  if (preferredNotifier && !preferredNotifier.window.isDestroyed()) {
    return preferredNotifier
  }
  if (preferredNotifier) {
    notifiersByWindowId.delete(preferred!.id)
  }
  for (const [windowId, notifier] of notifiersByWindowId) {
    if (!notifier.window.isDestroyed()) {
      return notifier
    }
    notifiersByWindowId.delete(windowId)
  }
  return null
}

export function getRuntimeWindowNotifierById(
  windowId: number | null
): RuntimeWindowNotifier | null {
  if (windowId === null) {
    return null
  }
  const notifier = notifiersByWindowId.get(windowId)
  if (!notifier || !getMainWindowById(windowId)) {
    return null
  }
  return notifier
}

/** Owner window when known, otherwise the window the user is looking at. */
export function resolveRuntimeWindowNotifier(
  ownerWindowId: number | null
): RuntimeWindowNotifier | null {
  return getRuntimeWindowNotifierById(ownerWindowId) ?? getPreferredRuntimeWindowNotifier()
}

export function broadcastRuntimeWindowNotification(channel: string, ...values: unknown[]): void {
  for (const [windowId, notifier] of notifiersByWindowId) {
    if (notifier.window.isDestroyed()) {
      notifiersByWindowId.delete(windowId)
      continue
    }
    notifier.send(channel, ...values)
  }
}

export function _resetRuntimeWindowNotifiersForTests(): void {
  notifiersByWindowId.clear()
}
