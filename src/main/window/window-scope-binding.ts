import type { BrowserWindow } from 'electron'
import {
  projectGroupWindowScopeKey,
  type ProjectGroupWindowOpenResult,
  type WindowScope,
  type WindowScopeChangedPayload,
  type WindowScopeChangeResult,
  type WindowScopeSnapshot
} from '../../shared/window-scope'
import type { WindowViewState } from '../../shared/window-view-state'
import { revealExistingMainWindow } from './main-window-open-policy'
import { getMainWindows, sendToWindow } from './main-window-registry'
import { setMainWindowProjectLabel } from './main-window-title'
import {
  areScopedWindowsEnabled,
  createWindowId,
  ensureWindowViewState,
  rebindWebContentsToWindowId,
  resolveWindowIdForWebContents,
  resolveWindowScope,
  resolveWindowScopeForWebContents
} from './window-view-state-registry'

/**
 * Binds live main windows to project groups. Main is the authority on a window's scope: the
 * renderer asks (`ui:getWindowScope`) and is told about rebinds (`ui:windowScopeChanged`);
 * the argv id only bootstraps the registry and goes stale on the first "change project".
 */

export const WINDOW_SCOPE_CHANGED_CHANNEL = 'ui:windowScopeChanged'

type SeedViewState = () => WindowViewState

// Why: the runtime's owner index ranks windows by scope, so every rebind must re-resolve it.
// A listener (set once at startup) keeps this module free of runtime imports.
let windowScopeRebindListener: (() => void) | null = null

export function setWindowScopeRebindListener(listener: (() => void) | null): void {
  windowScopeRebindListener = listener
}

export function getWindowScopeSnapshotForWebContents(webContentsId: number): WindowScopeSnapshot {
  return {
    scope: resolveWindowScopeForWebContents(webContentsId),
    scopedWindowsEnabled: areScopedWindowsEnabled()
  }
}

/** One window per project: the live window whose id is that group's scope key, if any. */
export function findMainWindowForProjectGroup(projectGroupId: string): BrowserWindow | null {
  const key = projectGroupWindowScopeKey(projectGroupId)
  return (
    getMainWindows().find(
      (window) => resolveWindowIdForWebContents(window.webContents.id) === key
    ) ?? null
  )
}

export function openProjectGroupWindow(args: {
  projectGroupId: string
  /** Name the requesting renderer resolved; main may not know remote groups, so the title takes it from here. */
  projectLabel: string | null
  openWindow: (windowId: string) => BrowserWindow | null
}): ProjectGroupWindowOpenResult {
  if (!areScopedWindowsEnabled()) {
    return { status: 'unavailable' }
  }
  const existing = findMainWindowForProjectGroup(args.projectGroupId)
  if (existing) {
    revealExistingMainWindow(existing)
    return { status: 'revealed-existing' }
  }
  const window = args.openWindow(projectGroupWindowScopeKey(args.projectGroupId))
  if (!window) {
    return { status: 'unavailable' }
  }
  setMainWindowProjectLabel(window, args.projectLabel)
  return { status: 'opened' }
}

function notifyWindowScopeChanged(window: BrowserWindow, seed: SeedViewState): void {
  const windowId = resolveWindowIdForWebContents(window.webContents.id)
  if (windowId === null) {
    return
  }
  const payload: WindowScopeChangedPayload = {
    scope: resolveWindowScope(windowId),
    scopedWindowsEnabled: areScopedWindowsEnabled(),
    viewState: ensureWindowViewState(windowId, seed)
  }
  sendToWindow(window, WINDOW_SCOPE_CHANGED_CHANNEL, payload)
}

/** Re-keys a live window onto a project group; the same project elsewhere is revealed instead. */
export function bindWindowToProjectGroup(
  window: BrowserWindow,
  args: { projectGroupId: string; projectLabel: string | null },
  seed: SeedViewState
): WindowScopeChangeResult {
  if (!areScopedWindowsEnabled()) {
    return { status: 'unavailable' }
  }
  const existing = findMainWindowForProjectGroup(args.projectGroupId)
  if (existing && existing !== window) {
    revealExistingMainWindow(existing)
    return { status: 'revealed-existing' }
  }
  const scope: WindowScope = {
    type: 'project-group',
    projectGroupId: args.projectGroupId
  }
  if (!existing) {
    rebindWebContentsToWindowId(
      window.webContents.id,
      projectGroupWindowScopeKey(scope.projectGroupId)
    )
  }
  setMainWindowProjectLabel(window, args.projectLabel)
  notifyWindowScopeChanged(window, seed)
  windowScopeRebindListener?.()
  return { status: 'bound', scope }
}

/**
 * Turns a scoped window back into a free one: a fresh UUID id seeded from the persisted filter
 * (the multi-pick the user had before), generic title. Never closes the window.
 */
export function releaseWindowScope(
  window: BrowserWindow,
  seed: SeedViewState
): WindowScopeChangeResult {
  if (resolveWindowScopeForWebContents(window.webContents.id) === null) {
    return { status: 'released' }
  }
  rebindWebContentsToWindowId(window.webContents.id, createWindowId())
  setMainWindowProjectLabel(window, null)
  notifyWindowScopeChanged(window, seed)
  windowScopeRebindListener?.()
  return { status: 'released' }
}

/** A deleted group's window survives as a free window; the group was the identity, not the window. */
export function releaseWindowsScopedToProjectGroups(
  projectGroupIds: Iterable<string>,
  seed: SeedViewState
): void {
  for (const projectGroupId of projectGroupIds) {
    const window = findMainWindowForProjectGroup(projectGroupId)
    if (window) {
      releaseWindowScope(window, seed)
    }
  }
}

/** The renderer resolved (or renamed) the group; a free window ignores it. */
export function setWindowScopeLabel(window: BrowserWindow, label: string | null): void {
  if (resolveWindowScopeForWebContents(window.webContents.id) === null) {
    return
  }
  setMainWindowProjectLabel(window, label)
}
