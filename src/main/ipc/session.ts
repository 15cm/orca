import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import type { Store } from '../persistence'
import type {
  WorkspaceSessionPatch,
  WorkspaceSessionState
} from '../../shared/workspace-session-state-types'
import {
  collectWorkspaceSessionWorktreeKeys,
  partitionWorkspaceSessionByWorktrees
} from '../../shared/workspace-session-window-rebase'
import type { WindowScope } from '../../shared/window-scope'
import { getMainWindows } from '../window/main-window-registry'
import { resolveWindowScopeForWebContents } from '../window/window-view-state-registry'
import {
  resolveScopeRepoIds,
  resolveScopeWorktreeIds,
  resolveScopesServedByOtherWindows
} from '../window/window-scoped-session-keys'

function scopeWorktreeIds(
  store: Store,
  scope: WindowScope,
  session: WorkspaceSessionState
): Set<string> {
  const repoIds = resolveScopeRepoIds(scope, store.getRepos(), store.getProjectGroups?.() ?? [])
  return resolveScopeWorktreeIds(session, repoIds)
}

/**
 * The worktrees the sending window owns, resolved from its scope. A free window owns everything
 * no project window is serving, which is what makes a project "move" out of the window it was
 * opened from; with no project windows up that is the whole session, exactly as before.
 */
function ownedWorktreeIdsForSender(
  store: Store,
  event: IpcMainEvent | IpcMainInvokeEvent | null | undefined,
  session: WorkspaceSessionState
): ReadonlySet<string> {
  const senderId = event?.sender?.id
  const scope = typeof senderId === 'number' ? resolveWindowScopeForWebContents(senderId) : null
  if (scope) {
    return scopeWorktreeIds(store, scope, session)
  }
  const served = new Set<string>()
  for (const otherScope of resolveScopesServedByOtherWindows(
    senderId,
    getMainWindows(),
    resolveWindowScopeForWebContents
  )) {
    for (const worktreeId of scopeWorktreeIds(store, otherScope, session)) {
      served.add(worktreeId)
    }
  }
  // Why the complement: the free window owns every key no project window is serving. An empty
  // result means no project windows are up, and the store then treats it as the shared writer.
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

export function registerSessionHandlers(store: Store): void {
  // Why: hostId is an optional second arg so an older renderer that invokes
  // these channels without it keeps reading/writing the 'local' partition
  // exactly as before. Channel names stay stable.
  // Why main projects instead of the renderer: a project window must see its own worktrees and
  // the shared window everything else, and only main knows the scope at first paint.
  ipcMain.handle('session:get', (event, hostId?: string | null) => {
    const session = store.getWorkspaceSession(hostId)
    const owned = ownedWorktreeIdsForSender(store, event, session)
    // Why one branch for both window kinds: `owned` already means "the keys this window serves",
    // so a project window gets its group and the free window gets everything else.
    return owned.size === 0 ? session : partitionWorkspaceSessionByWorktrees(session, owned).owned
  })

  // Why the third arg is optional too: a window that declares no owned worktrees is the shared
  // writer and its write replaces the session whole, exactly as before scoped windows existed.
  ipcMain.handle('session:set', (event, args: WorkspaceSessionState, hostId?: string | null) => {
    store.setWorkspaceSession(args, hostId, ownedWorktreeIdsForSender(store, event, args))
  })

  ipcMain.handle('session:patch', (event, args: WorkspaceSessionPatch, hostId?: string | null) => {
    // Why the stored session and not the patch: a patch carries only changed fields, and the
    // scope has to be resolved against every key the window could own.
    const owned = ownedWorktreeIdsForSender(store, event, store.getWorkspaceSession(hostId))
    store.patchWorkspaceSession(args, hostId, owned)
  })

  ipcMain.handle('session:flush', () => {
    // Why: durable lifecycle RPCs must propagate disk failures instead of
    // returning success through Store.flush(), which intentionally only logs.
    store.flushOrThrow()
  })

  // Synchronous variant for the renderer's beforeunload handler.
  // sendSync blocks the renderer until this returns, guaranteeing the
  // data (including terminal scrollback buffers) is persisted to disk
  // before the window closes — regardless of before-quit ordering.
  ipcMain.on('session:set-sync', (event, args: WorkspaceSessionState, hostId?: string | null) => {
    store.setWorkspaceSession(args, hostId, ownedWorktreeIdsForSender(store, event, args))
    store.flush()
    event.returnValue = true
  })

  ipcMain.on(
    'session:read-terminal-scrollback-sync',
    (event, args: { ref?: unknown } | undefined) => {
      event.returnValue =
        typeof args?.ref === 'string' ? store.readTerminalScrollbackSnapshot(args.ref) : null
    }
  )
}
