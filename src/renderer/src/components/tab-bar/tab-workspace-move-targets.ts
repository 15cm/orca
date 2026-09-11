import type { AppState } from '../../store/types'
import type { Worktree } from '../../../../shared/worktree/types'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host'
import { useAppStore } from '../../store'
import { findTabAndWorktree } from '../../store/slices/tab-group-state'
import { isMovableTabContentType } from '../../store/slices/tab-workspace-move'
import { getWorktreeOnHostFromState } from '../../store/selectors'
import { getUnifiedTabPaletteExecutionHostId } from '@/lib/unified-tab-host-ownership'
import { isExecutionHostAliasForWorktree } from '@/lib/worktree-execution-host-alias'
import {
  getRuntimeEnvironmentIdForWorktree,
  type WorktreeRuntimeOwnerState
} from '@/lib/worktree-runtime-owner'
import { isWebRuntimeSessionActive } from '../../runtime/web-runtime-session'
import {
  getPublishedVisibleWorktreeShortcutTargets,
  type VisibleWorktreeShortcutTarget
} from '../sidebar/rendered-sidebar-worktree-publication'

export type TabWorkspaceMoveTarget = {
  worktreeId: string
  label: string
}

type MoveTargetState = WorktreeRuntimeOwnerState &
  Pick<AppState, 'unifiedTabsByWorktree' | 'worktreesByRepo'>

/** Why excluded: a runtime-owned workspace's tab model lives on the remote host,
 *  and no `session.tabs.*` RPC can rehome a tab across workspaces yet, so a local
 *  move would be overwritten by the host's next snapshot. */
function isHostOwnedTabModel(state: MoveTargetState, worktreeId: string): boolean {
  return isWebRuntimeSessionActive(getRuntimeEnvironmentIdForWorktree(state, worktreeId))
}

function resolveWorktreeRow(
  state: MoveTargetState,
  target: VisibleWorktreeShortcutTarget
): Worktree | undefined {
  return getWorktreeOnHostFromState(state, target.id, target.executionHostId)
}

/** Destination workspaces a tab may move to, in rendered sidebar order.
 *  Full rules: docs/reference/tab-workspace-move.md.
 *  Same execution host only — a PTY on an SSH host cannot follow its tab into a
 *  local workspace (docs/reference/ssh-execution-boundary.md). */
export function resolveTabWorkspaceMoveTargets(
  state: MoveTargetState,
  orderedTargets: readonly VisibleWorktreeShortcutTarget[],
  unifiedTabId: string
): TabWorkspaceMoveTarget[] {
  const found = findTabAndWorktree(state.unifiedTabsByWorktree, unifiedTabId)
  if (!found || !isMovableTabContentType(found.tab.contentType)) {
    return []
  }
  const source = resolveWorktreeRow(state, {
    id: found.worktreeId,
    ...(found.tab.executionHostId ? { executionHostId: found.tab.executionHostId } : {})
  })
  if (!source || isHostOwnedTabModel(state, found.worktreeId)) {
    return []
  }
  // Why the local default: isExecutionHostAliasForWorktree reads an absent hostId
  // as local, so the tab side has to agree or a plain local tab matches nothing.
  const tabHostId =
    getUnifiedTabPaletteExecutionHostId(found.tab, source) ?? LOCAL_EXECUTION_HOST_ID

  const targets: TabWorkspaceMoveTarget[] = []
  for (const candidate of orderedTargets) {
    if (candidate.id === found.worktreeId) {
      continue
    }
    const row = resolveWorktreeRow(state, candidate)
    if (
      !row ||
      row.isArchived ||
      !isExecutionHostAliasForWorktree(tabHostId, row) ||
      isHostOwnedTabModel(state, row.id)
    ) {
      continue
    }
    targets.push({ worktreeId: row.id, label: row.displayName })
  }
  return targets
}

/** Why the catalog fallback: the rendered order is only published while the
 *  sidebar workspace list is mounted. With it collapsed the menu still has to
 *  offer every destination, in a stable order, without pulling the sidebar's row
 *  pipeline into a context-menu render. */
function orderedWorkspaceTargets(state: MoveTargetState): VisibleWorktreeShortcutTarget[] {
  const published = getPublishedVisibleWorktreeShortcutTargets()
  if (published) {
    return published
  }
  return Object.values(state.worktreesByRepo ?? {}).flatMap((worktrees) =>
    worktrees.map((worktree) => ({
      id: worktree.id,
      ...(worktree.hostId ? { executionHostId: worktree.hostId } : {})
    }))
  )
}

export function getTabWorkspaceMoveTargets(unifiedTabId: string): TabWorkspaceMoveTarget[] {
  const state = useAppStore.getState()
  return resolveTabWorkspaceMoveTargets(state, orderedWorkspaceTargets(state), unifiedTabId)
}
