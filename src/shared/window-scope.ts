import type { WindowViewState } from './window-view-state'

/**
 * A window's scope: the project group it is bound to, if any. No new entity — the project group
 * is the durable identity. The scope key doubles as the window id main routes per-window
 * view-state by (see main/window/window-view-state-registry), so a scoped window's view-state is
 * a function of its identity and needs no persistence of its own.
 */
export type WindowScope = { type: 'project-group'; projectGroupId: string }

/** `group:<projectGroupId>`; a free window's id is a per-launch UUID and never parses as one. */
export type WindowScopeKey = string

const PROJECT_GROUP_WINDOW_SCOPE_PREFIX = 'group:'

export function projectGroupWindowScopeKey(projectGroupId: string): WindowScopeKey {
  return `${PROJECT_GROUP_WINDOW_SCOPE_PREFIX}${projectGroupId}`
}

export function windowScopeKey(scope: WindowScope): WindowScopeKey {
  return projectGroupWindowScopeKey(scope.projectGroupId)
}

/** null means a free window. */
export function parseWindowScopeKey(value: string): WindowScope | null {
  if (!value.startsWith(PROJECT_GROUP_WINDOW_SCOPE_PREFIX)) {
    return null
  }
  const projectGroupId = value.slice(PROJECT_GROUP_WINDOW_SCOPE_PREFIX.length)
  return projectGroupId.length > 0 ? { type: 'project-group', projectGroupId } : null
}

export function isSameWindowScope(left: WindowScope | null, right: WindowScope | null): boolean {
  if (left === null || right === null) {
    return left === right
  }
  return left.type === right.type && left.projectGroupId === right.projectGroupId
}

/**
 * What main tells a renderer about its window. Main is the authority: argv only bootstraps the
 * registry, and a rebind ("change project", "free mode") reaches the renderer through
 * `ui:windowScopeChanged`, never through the frozen argv id.
 */
export type WindowScopeSnapshot = {
  scope: WindowScope | null
  /** Launch-time snapshot of the experimental multi-window flag; false hides every scoped-window affordance. */
  scopedWindowsEnabled: boolean
}

export type WindowScopeChangedPayload = WindowScopeSnapshot & {
  viewState: WindowViewState
}

export type WindowScopeChangeResult =
  | { status: 'bound'; scope: WindowScope }
  | { status: 'released' }
  /** Another live window already holds that scope and was revealed instead: one window per project. */
  | { status: 'revealed-existing' }
  /** Scoped windows cannot exist this launch (flag off) or the sender is not a main window. */
  | { status: 'unavailable' }

export type ProjectGroupWindowOpenResult = {
  status: 'opened' | 'revealed-existing' | 'unavailable'
}
