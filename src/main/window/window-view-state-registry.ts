import { randomUUID } from 'node:crypto'
import { mergeWindowViewState, type WindowViewState } from '../../shared/window-view-state'

/**
 * In-memory owner of each main window's view-state, keyed by the window id the renderer also
 * knows (see shared/window-identity). Window ids are strings on purpose: a future window
 * profile substitutes its stable id here without touching the ui:get / ui:set routing.
 */
const viewStateByWindowId = new Map<string, WindowViewState>()
const windowIdByWebContentsId = new Map<number, string>()

export function createWindowId(): string {
  return randomUUID()
}

export function bindWindowIdToWebContents(webContentsId: number, windowId: string): void {
  windowIdByWebContentsId.set(webContentsId, windowId)
}

/** Drops the binding and the window's view-state; nothing outlives the window until profiles exist. */
export function unbindWindowIdFromWebContents(webContentsId: number): void {
  const windowId = windowIdByWebContentsId.get(webContentsId)
  windowIdByWebContentsId.delete(webContentsId)
  if (windowId !== undefined && ![...windowIdByWebContentsId.values()].includes(windowId)) {
    viewStateByWindowId.delete(windowId)
  }
}

export function resolveWindowIdForWebContents(webContentsId: number): string | null {
  return windowIdByWebContentsId.get(webContentsId) ?? null
}

export function getWindowViewState(windowId: string): WindowViewState | null {
  return viewStateByWindowId.get(windowId) ?? null
}

/** Returns the window's view-state, seeding it lazily so a window's first read defines its baseline. */
export function ensureWindowViewState(
  windowId: string,
  seed: () => WindowViewState
): WindowViewState {
  const existing = viewStateByWindowId.get(windowId)
  if (existing) {
    return existing
  }
  const seeded = seed()
  viewStateByWindowId.set(windowId, seeded)
  return seeded
}

export function updateWindowViewState(
  windowId: string,
  updates: Partial<WindowViewState>,
  seed: () => WindowViewState
): WindowViewState {
  const next = mergeWindowViewState(ensureWindowViewState(windowId, seed), updates)
  viewStateByWindowId.set(windowId, next)
  return next
}

export function _resetWindowViewStateRegistryForTests(): void {
  viewStateByWindowId.clear()
  windowIdByWebContentsId.clear()
}
