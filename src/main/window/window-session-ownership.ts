import type { Store } from '../persistence'
import type { WindowScope } from '../../shared/window-scope'
import type { WorkspaceSessionState } from '../../shared/workspace-session-state-types'
import { collectWorkspaceSessionWorktreeKeys } from '../../shared/workspace-session-window-rebase'
import { getMainWindows } from './main-window-registry'
import {
  resolveScopeSessionKeys,
  resolveScopesServedByOtherWindows
} from './window-scoped-session-keys'
import { resolveWindowScopeForWebContents } from './window-view-state-registry'

/**
 * Which workspaces one live window owns. Read by the session channels (`main/ipc/session.ts`) and
 * by the live release that tells a window to let go of a project another window took over.
 */

export function scopeSessionKeys(
  store: Store,
  scope: WindowScope,
  session: WorkspaceSessionState
): Set<string> {
  return resolveScopeSessionKeys(scope, session, {
    getRepo: (repoId) => store.getRepo(repoId),
    getFolderWorkspaces: () => store.getFolderWorkspaces?.() ?? [],
    getProjectGroups: () => store.getProjectGroups?.() ?? []
  })
}

/**
 * A project window owns the keys of its group; a free window owns everything no project window is
 * serving, which is what makes a project "move" out of the window it was opened from. An empty
 * result from a free window means no project windows are up: it is the shared writer and owns the
 * whole session, exactly as before scoped windows existed.
 */
export function ownedSessionKeysForWindow(
  store: Store,
  webContentsId: number | undefined,
  session: WorkspaceSessionState
): ReadonlySet<string> {
  const scope =
    typeof webContentsId === 'number' ? resolveWindowScopeForWebContents(webContentsId) : null
  if (scope) {
    return scopeSessionKeys(store, scope, session)
  }
  const served = new Set<string>()
  for (const otherScope of resolveScopesServedByOtherWindows(
    webContentsId,
    getMainWindows(),
    resolveWindowScopeForWebContents
  )) {
    for (const key of scopeSessionKeys(store, otherScope, session)) {
      served.add(key)
    }
  }
  if (served.size === 0) {
    return new Set()
  }
  const owned = new Set<string>()
  for (const key of collectWorkspaceSessionWorktreeKeys(session)) {
    if (!served.has(key)) {
      owned.add(key)
    }
  }
  return owned
}
