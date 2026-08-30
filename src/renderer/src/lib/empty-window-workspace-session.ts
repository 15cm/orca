import type { WindowSessionAdoption } from '../../../shared/window-session-adoption'
import type { WorkspaceSessionState } from '../../../shared/workspace-session-state-types'
import type { WorkspaceSessionHostRead } from './workspace-session-host-hydration'

type EmptyWindowSessionFieldPolicy = 'carry' | 'drop'

/**
 * Per persisted session field: does a window that opens empty still read it?
 *
 * `drop` is everything a user would call open — workspaces, tabs, layouts, files, and the SSH
 * targets a startup restore would dial. `carry` is history and ledgers, which say nothing about
 * what is on screen and which such a window never writes back. The exhaustive guard below forces
 * a new session field to be classified instead of leaking into an empty window by default.
 */
export const EMPTY_WINDOW_SESSION_FIELD_POLICY = {
  activeRepoId: 'drop',
  activeWorkspaceKey: 'drop',
  activeWorkspaceExecutionHostId: 'drop',
  activeWorktreeId: 'drop',
  activeTabId: 'drop',
  tabsByWorktree: 'drop',
  terminalLayoutsByTabId: 'drop',
  activeWorktreeIdsOnShutdown: 'drop',
  openFilesByWorktree: 'drop',
  activeFileIdByWorktree: 'drop',
  markdownFrontmatterVisible: 'drop',
  browserTabsByWorktree: 'drop',
  browserPagesByWorkspace: 'drop',
  activeBrowserTabIdByWorktree: 'drop',
  activeTabTypeByWorktree: 'drop',
  activeTabIdByWorktree: 'drop',
  unifiedTabs: 'drop',
  tabGroups: 'drop',
  tabGroupLayouts: 'drop',
  activeGroupIdByWorktree: 'drop',
  remoteSessionIdsByTabId: 'drop',
  sleepingAgentSessionsByPaneKey: 'drop',
  terminalPtyIncarnationsByPaneKey: 'drop',
  terminalTopologyRevisionByRepoId: 'drop',
  terminalSurfaceTombstonesByPaneKey: 'drop',
  // Why: a startup SSH restore would let the target's remote workspace snapshot land straight
  // back in the window that just opened empty. The connection is dialed on demand instead.
  activeConnectionIdsAtShutdown: 'drop',
  // Address-bar autocomplete, not an open page.
  browserUrlHistory: 'carry',
  // Cmd+J empty-query ordering; recency is not an open workspace.
  lastVisitedAtByWorktreeId: 'carry',
  // Why: this ledger records that a repo's default tabs already ran. Dropping it re-runs the
  // repo's tab template — and its commands — the first time a workspace opens here.
  defaultTerminalTabsAppliedByWorktreeId: 'carry',
  // Runtime-owned pages are workspace UI and must not appear in an empty window.
  clientHostedBrowserPagesByWorktree: 'drop',
  // Replayable close intent is global profile state, not an open workspace.
  clientHostedBrowserCloseIntentsByEnvironment: 'carry',
  workspaceDocHistory: 'carry',
  closedTerminalTabTombstonesByTabId: 'carry'
} as const satisfies Record<keyof WorkspaceSessionState, EmptyWindowSessionFieldPolicy>

type MissingPolicy = Exclude<
  keyof WorkspaceSessionState,
  keyof typeof EMPTY_WINDOW_SESSION_FIELD_POLICY
>
const exhaustive: [MissingPolicy] extends [never] ? true : never = true
void exhaustive

/** The persisted session reduced to what a window with nothing open still needs. */
export function emptyWindowWorkspaceSession(session: WorkspaceSessionState): WorkspaceSessionState {
  return {
    activeRepoId: null,
    activeWorktreeId: null,
    activeTabId: null,
    tabsByWorktree: {},
    terminalLayoutsByTabId: {},
    browserUrlHistory: session.browserUrlHistory,
    workspaceDocHistory: session.workspaceDocHistory,
    lastVisitedAtByWorktreeId: session.lastVisitedAtByWorktreeId,
    defaultTerminalTabsAppliedByWorktreeId: session.defaultTerminalTabsAppliedByWorktreeId,
    clientHostedBrowserCloseIntentsByEnvironment:
      session.clientHostedBrowserCloseIntentsByEnvironment,
    closedTerminalTabTombstonesByTabId: session.closedTerminalTabTombstonesByTabId
  }
}

/**
 * The session a window hydrates from.
 *
 * Main partitions the read by the sending window's scope (`main/ipc/session.ts`), so a scoped
 * window already receives only its project's keys and there is nothing left to project here. The
 * carry/drop policy above still documents what a window with no project of its own would keep,
 * and its exhaustiveness guard still forces every new session field to be classified.
 */
export function adoptWorkspaceSessionRead(
  read: WorkspaceSessionHostRead,
  _adoption: WindowSessionAdoption
): WorkspaceSessionHostRead {
  return read
}
