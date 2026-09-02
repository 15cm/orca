import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import type { Store } from '../persistence'
import type { WindowScope } from '../../shared/window-scope'
import type {
  WorkspaceSessionPatch,
  WorkspaceSessionState
} from '../../shared/workspace-session-state-types'
import { partitionWorkspaceSessionByWorktrees } from '../../shared/workspace-session-window-rebase'
import { resolveWindowScopeForWebContents } from '../window/window-view-state-registry'
import { ownedSessionKeysForWindow } from '../window/window-session-ownership'
import { withProjectWindowFocus } from '../window/project-window-session-focus'
import { closeTerminalTabInWorkspaceSession } from '../../shared/workspace-session-terminal-tab-close'
import { advanceTerminalTopologyRevision } from '../runtime/workspace-session-terminal-membership-authority'

function resolveSenderWindowScope(
  event: IpcMainEvent | IpcMainInvokeEvent | null | undefined
): WindowScope | null {
  const senderId = event?.sender?.id
  return typeof senderId === 'number' ? resolveWindowScopeForWebContents(senderId) : null
}

/**
 * The worktrees the sending window owns, resolved from its scope. A free window owns everything
 * no project window is serving, which is what makes a project "move" out of the window it was
 * opened from; with no project windows up that is the whole session, exactly as before.
 */
function ownedSessionKeysForSender(
  store: Store,
  event: IpcMainEvent | IpcMainInvokeEvent | null | undefined,
  session: WorkspaceSessionState
): ReadonlySet<string> {
  return ownedSessionKeysForWindow(store, event?.sender?.id, session)
}

export function registerSessionHandlers(store: Store): void {
  // Why: hostId is an optional second arg so an older renderer that invokes
  // these channels without it keeps reading/writing the 'local' partition
  // exactly as before. Channel names stay stable.
  // Why main projects instead of the renderer: a project window must see its own worktrees and
  // the shared window everything else, and only main knows the scope at first paint.
  ipcMain.handle('session:get', (event, hostId?: string | null) => {
    const session = store.getWorkspaceSession(hostId)
    const owned = ownedSessionKeysForSender(store, event, session)
    // Why one branch for both window kinds: `owned` already means "the keys this window serves",
    // so a project window gets its group and the free window gets everything else.
    if (owned.size === 0) {
      return session
    }
    const read = partitionWorkspaceSessionByWorktrees(session, owned).owned
    return resolveSenderWindowScope(event) ? withProjectWindowFocus(read, owned) : read
  })

  // Why the third arg is optional too: a window that declares no owned worktrees is the shared
  // writer and its write replaces the session whole, exactly as before scoped windows existed.
  ipcMain.handle('session:set', (event, args: WorkspaceSessionState, hostId?: string | null) => {
    store.setWorkspaceSession(args, hostId, ownedSessionKeysForSender(store, event, args))
  })

  ipcMain.handle('session:patch', (event, args: WorkspaceSessionPatch, hostId?: string | null) => {
    // Why the stored session and not the patch: a patch carries only changed fields, and the
    // scope has to be resolved against every key the window could own.
    const owned = ownedSessionKeysForSender(store, event, store.getWorkspaceSession(hostId))
    store.patchWorkspaceSession(args, hostId, owned)
  })

  ipcMain.handle('session:flush', () => {
    // Why: durable lifecycle RPCs must propagate disk failures instead of
    // returning success through Store.flush(), which intentionally only logs.
    store.flushOrThrow()
  })

  ipcMain.handle(
    'session:closeTerminalTab',
    (
      event,
      args: { worktreeId?: unknown; tabId?: unknown; confirmed?: unknown },
      hostId?: string | null
    ): { closed: boolean; pinned: boolean } => {
      if (typeof args?.worktreeId !== 'string' || typeof args?.tabId !== 'string') {
        throw new Error('invalid_terminal_tab_close')
      }
      const session = store.getWorkspaceSession(hostId)
      const owned = ownedSessionKeysForSender(store, event, session)
      if (owned.size > 0 && !owned.has(args.worktreeId)) {
        throw new Error('worktree_not_owned')
      }
      const result = closeTerminalTabInWorkspaceSession(session, args.worktreeId, args.tabId)
      if (result.pinned) {
        if (args.confirmed !== true) {
          return { closed: false, pinned: true }
        }
        // Renderer pin confirmation is the user authorization; preserve the host-side guard for all other callers.
        const unpinnedSession = {
          ...session,
          tabsByWorktree: {
            ...session.tabsByWorktree,
            [args.worktreeId]: (session.tabsByWorktree[args.worktreeId] ?? []).map((tab) =>
              tab.id === args.tabId ? { ...tab, isPinned: false } : tab
            )
          },
          unifiedTabs: {
            ...session.unifiedTabs,
            [args.worktreeId]: (session.unifiedTabs?.[args.worktreeId] ?? []).map((tab) =>
              tab.id === args.tabId || tab.entityId === args.tabId
                ? { ...tab, isPinned: false }
                : tab
            )
          }
        }
        const confirmedResult = closeTerminalTabInWorkspaceSession(
          unpinnedSession,
          args.worktreeId,
          args.tabId
        )
        if (!confirmedResult.closed) {
          return { closed: false, pinned: true }
        }
        store.setWorkspaceSession(
          advanceTerminalTopologyRevision(confirmedResult.session, args.worktreeId),
          hostId,
          owned
        )
        try {
          store.flushOrThrow()
        } catch (error) {
          store.setWorkspaceSession(session, hostId, owned)
          throw error
        }
        return { closed: true, pinned: false }
      }
      if (!result.closed) {
        return { closed: false, pinned: false }
      }
      if (!store.setWorkspaceSession || !store.flushOrThrow) {
        throw new Error('workspace_session_unavailable')
      }
      store.setWorkspaceSession(
        advanceTerminalTopologyRevision(result.session, args.worktreeId),
        hostId,
        owned
      )
      try {
        store.flushOrThrow()
      } catch (error) {
        store.setWorkspaceSession(session, hostId, owned)
        throw error
      }
      return { closed: true, pinned: false }
    }
  )

  // Synchronous variant for the renderer's beforeunload handler.
  // sendSync blocks the renderer until this returns, guaranteeing the
  // data (including terminal scrollback buffers) is persisted to disk
  // before the window closes — regardless of before-quit ordering.
  ipcMain.on('session:set-sync', (event, args: WorkspaceSessionState, hostId?: string | null) => {
    store.setWorkspaceSession(args, hostId, ownedSessionKeysForSender(store, event, args))
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
