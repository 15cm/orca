import type { WorkspaceSessionState } from './workspace-session-state-types'

export type WorkspaceSessionFieldOwnership =
  | 'global'
  | 'hostPrivate'
  | 'worktreeKeyed'
  | 'worktreeArray'
  | 'tabKeyed'
  | 'browserWorkspaceKeyed'
  | 'fileKeyed'
  | 'sleepingAgentKeyed'
  | 'paneKeyed'
  | 'surfaceTombstoneKeyed'

export const WORKSPACE_SESSION_FIELD_OWNERSHIP = {
  activeRepoId: 'global',
  activeWorktreeId: 'global',
  activeWorkspaceExecutionHostId: 'global',
  activeTabId: 'global',
  browserUrlHistory: 'global',
  workspaceDocHistory: 'global',
  // Why: SSH remains local-owned, so its connection identifiers stay in the local slice.
  activeConnectionIdsAtShutdown: 'global',
  // Why global: keyed by runtime environment rather than by worktree.
  clientHostedBrowserCloseIntentsByEnvironment: 'global',
  tabsByWorktree: 'worktreeKeyed',
  openFilesByWorktree: 'worktreeKeyed',
  activeFileIdByWorktree: 'worktreeKeyed',
  activeBrowserTabIdByWorktree: 'worktreeKeyed',
  activeTabTypeByWorktree: 'worktreeKeyed',
  activeTabIdByWorktree: 'worktreeKeyed',
  browserTabsByWorktree: 'worktreeKeyed',
  // Runtime-authored; route rows back to owning host on merged reads.
  clientHostedBrowserPagesByWorktree: 'worktreeKeyed',
  unifiedTabs: 'worktreeKeyed',
  tabGroups: 'worktreeKeyed',
  tabGroupLayouts: 'worktreeKeyed',
  activeGroupIdByWorktree: 'worktreeKeyed',
  lastVisitedAtByWorktreeId: 'worktreeKeyed',
  defaultTerminalTabsAppliedByWorktreeId: 'worktreeKeyed',
  activeWorkspaceKey: 'global',
  activeWorktreeIdsOnShutdown: 'worktreeArray',
  terminalLayoutsByTabId: 'tabKeyed',
  remoteSessionIdsByTabId: 'tabKeyed',
  browserPagesByWorkspace: 'browserWorkspaceKeyed',
  markdownFrontmatterVisible: 'fileKeyed',
  sleepingAgentSessionsByPaneKey: 'sleepingAgentKeyed',
  terminalPtyIncarnationsByPaneKey: 'paneKeyed',
  // Why: this host-issued fence must never collide while unified renderer state merges equal repo ids across hosts.
  terminalTopologyRevisionByRepoId: 'hostPrivate',
  terminalSurfaceTombstonesByPaneKey: 'surfaceTombstoneKeyed',
  // Tab is gone; route by record worktreeId.
  closedTerminalTabTombstonesByTabId: 'surfaceTombstoneKeyed'
} as const satisfies Record<keyof WorkspaceSessionState, WorkspaceSessionFieldOwnership>

// Why: an unclassified persisted field would otherwise disappear from every non-local host.
type MissingOwnership = Exclude<
  keyof WorkspaceSessionState,
  keyof typeof WORKSPACE_SESSION_FIELD_OWNERSHIP
>
const exhaustive: [MissingOwnership] extends [never] ? true : never = true
void exhaustive

export const GLOBAL_WORKSPACE_SESSION_FIELDS = (
  Object.keys(WORKSPACE_SESSION_FIELD_OWNERSHIP) as (keyof WorkspaceSessionState)[]
).filter((field) => WORKSPACE_SESSION_FIELD_OWNERSHIP[field] === 'global')

export const HOST_PARTITION_REDUNDANT_GLOBAL_FIELDS = [
  'browserUrlHistory',
  'workspaceDocHistory'
] as const satisfies readonly (keyof WorkspaceSessionState)[]

export function withoutRedundantPartitionGlobals<
  T extends Partial<Record<string, WorkspaceSessionState>>
>(partitions: T, local: Partial<WorkspaceSessionState> | undefined): T {
  let pruned: Record<string, WorkspaceSessionState | undefined> | undefined
  for (const [hostId, slice] of Object.entries(partitions) as [
    string,
    WorkspaceSessionState | undefined
  ][]) {
    if (!slice) {
      continue
    }
    const next = withoutRedundantGlobalFields(slice, local)
    if (next === slice) {
      continue
    }
    pruned ||= { ...partitions }
    pruned[hostId] = next
  }
  return (pruned as T | undefined) ?? partitions
}

export function hostPartitionSliceTemplate(template: WorkspaceSessionState): WorkspaceSessionState {
  return withoutRedundantGlobalFields(template, template)
}

export function withoutRedundantGlobalFields<T extends Partial<WorkspaceSessionState>>(
  slice: T,
  local: Partial<WorkspaceSessionState> | undefined
): T {
  let pruned: T | undefined
  for (const field of HOST_PARTITION_REDUNDANT_GLOBAL_FIELDS) {
    if (local?.[field] === undefined || !Object.hasOwn(slice, field)) {
      continue
    }
    pruned ??= { ...slice }
    delete pruned[field]
  }
  return pruned ?? slice
}
