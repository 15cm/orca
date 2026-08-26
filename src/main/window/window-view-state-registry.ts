import { randomUUID } from 'node:crypto'
import { parseWindowScopeKey, type WindowScope } from '../../shared/window-scope'
import {
  deriveWindowViewState,
  mergeWindowViewState,
  type WindowViewState
} from '../../shared/window-view-state'

/**
 * In-memory owner of each main window's view-state, keyed by the window id the renderer also
 * knows (see shared/window-identity). Window ids are strings on purpose: a scoped window's id
 * is its scope key (`group:<projectGroupId>`, see shared/window-scope), so its view-state is
 * derived from the id instead of seeded from the persisted profile.
 */
const viewStateByWindowId = new Map<string, WindowViewState>()
const windowIdByWebContentsId = new Map<number, string>()
// Why: snapshotted once at launch, like the menu's New Window. With the flag off nothing may
// open a scoped window, and a scope key that slipped through is treated as a plain id.
let scopedWindowsEnabled = false

export function setScopedWindowsEnabled(enabled: boolean): void {
  scopedWindowsEnabled = enabled
}

export function areScopedWindowsEnabled(): boolean {
  return scopedWindowsEnabled
}

export function createWindowId(): string {
  return randomUUID()
}

/** The scope a window id carries, or null for a free window (and for every window while the flag is off). */
export function resolveWindowScope(windowId: string): WindowScope | null {
  return scopedWindowsEnabled ? parseWindowScopeKey(windowId) : null
}

export function resolveWindowScopeForWebContents(webContentsId: number): WindowScope | null {
  const windowId = windowIdByWebContentsId.get(webContentsId)
  return windowId === undefined ? null : resolveWindowScope(windowId)
}

export function bindWindowIdToWebContents(webContentsId: number, windowId: string): void {
  windowIdByWebContentsId.set(webContentsId, windowId)
}

function isWindowIdBound(windowId: string): boolean {
  for (const bound of windowIdByWebContentsId.values()) {
    if (bound === windowId) {
      return true
    }
  }
  return false
}

/** Drops the binding and the window's view-state; nothing outlives the window. */
export function unbindWindowIdFromWebContents(webContentsId: number): void {
  const windowId = windowIdByWebContentsId.get(webContentsId)
  windowIdByWebContentsId.delete(webContentsId)
  if (windowId !== undefined && !isWindowIdBound(windowId)) {
    viewStateByWindowId.delete(windowId)
  }
}

/** Re-keys a live window ("change project", "free mode"); the old id's state goes with the old key. */
export function rebindWebContentsToWindowId(webContentsId: number, windowId: string): void {
  unbindWindowIdFromWebContents(webContentsId)
  bindWindowIdToWebContents(webContentsId, windowId)
}

export function resolveWindowIdForWebContents(webContentsId: number): string | null {
  return windowIdByWebContentsId.get(webContentsId) ?? null
}

export function getWebContentsIdsForWindowId(windowId: string): number[] {
  const ids: number[] = []
  for (const [webContentsId, bound] of windowIdByWebContentsId) {
    if (bound === windowId) {
      ids.push(webContentsId)
    }
  }
  return ids
}

export function getWindowViewState(windowId: string): WindowViewState | null {
  return viewStateByWindowId.get(windowId) ?? null
}

/**
 * Returns the window's view-state, seeding it lazily so a window's first read defines its
 * baseline. A scoped window ignores the seed: its baseline is derived from the scope.
 */
export function ensureWindowViewState(
  windowId: string,
  seed: () => WindowViewState
): WindowViewState {
  const existing = viewStateByWindowId.get(windowId)
  if (existing) {
    return existing
  }
  const scope = resolveWindowScope(windowId)
  const seeded = scope ? deriveWindowViewState(scope) : seed()
  viewStateByWindowId.set(windowId, seeded)
  return seeded
}

export function updateWindowViewState(
  windowId: string,
  updates: Partial<WindowViewState>,
  seed: () => WindowViewState
): WindowViewState {
  const merged = mergeWindowViewState(ensureWindowViewState(windowId, seed), updates)
  const scope = resolveWindowScope(windowId)
  // Why: a scoped window may widen its project picks, but its group filter IS its identity —
  // no renderer write (stale reload, clear-filters path) may detach it.
  const next = scope
    ? { ...merged, filterGroupIds: deriveWindowViewState(scope).filterGroupIds }
    : merged
  viewStateByWindowId.set(windowId, next)
  return next
}

export function _resetWindowViewStateRegistryForTests(): void {
  viewStateByWindowId.clear()
  windowIdByWebContentsId.clear()
  scopedWindowsEnabled = false
}
