import { getRepoIdFromWorktreeId } from '../../shared/worktree/id'
import {
  folderWorkspaceKey,
  parseWorkspaceKey,
  worktreeWorkspaceKey
} from '../../shared/workspace-scope'
import type { WorkspaceSessionState } from '../../shared/workspace-session-state-types'

/**
 * The workspace a project window opens on.
 *
 * The stored focus names exactly one workspace, and the partition gives it to whichever window
 * serves it (`shared/workspace-session-window-rebase`). So a project window opened while the user
 * was looking at a different project reads its own tabs with nothing selected — the "opens empty"
 * report. It picks its own focus instead: the most recently visited workspace it serves that has
 * tabs to show.
 *
 * Only ever a fallback: a read that already carries a focus is returned untouched. And a project
 * window never writes the global fields back, so this is re-derived on every open rather than
 * being remembered — which is why it must be cheap and deterministic.
 */
export function withProjectWindowFocus(
  read: WorkspaceSessionState,
  owned: ReadonlySet<string>
): WorkspaceSessionState {
  // Why `?? null`: the partition writes null, but a session built elsewhere leaves these unset.
  if ((read.activeWorktreeId ?? null) !== null || (read.activeWorkspaceKey ?? null) !== null) {
    return read
  }
  const workspaceKey = pickMostRecentlyVisitedWorkspace(read, owned)
  if (workspaceKey === null) {
    return read
  }
  const scope = parseWorkspaceKey(workspaceKey)
  const folder = scope?.type === 'folder' ? folderWorkspaceKey(scope.folderWorkspaceId) : null
  const worktreeId = scope?.type === 'worktree' ? scope.worktreeId : workspaceKey
  return {
    ...read,
    // Why the key and not a worktree id for a folder workspace: that is how the renderer stores
    // an active folder workspace (`set-active-folder-workspace.ts`), null repo id included.
    activeWorktreeId: folder ?? worktreeId,
    activeWorkspaceKey: folder ?? worktreeWorkspaceKey(worktreeId),
    activeRepoId: folder ? null : getRepoIdFromWorktreeId(worktreeId),
    activeTabId: read.activeTabIdByWorktree?.[workspaceKey] ?? firstTabId(read, workspaceKey)
  }
}

/** Only workspaces with tabs: one with none has nothing to restore and no proof it still exists. */
function pickMostRecentlyVisitedWorkspace(
  read: WorkspaceSessionState,
  owned: ReadonlySet<string>
): string | null {
  const visitedAt = read.lastVisitedAtByWorktreeId ?? {}
  let best: string | null = null
  let bestVisitedAt = -Infinity
  for (const workspaceKey of owned) {
    if (firstTabId(read, workspaceKey) === null) {
      continue
    }
    const candidateVisitedAt = visitedAt[workspaceKey] ?? 0
    // Why the key tiebreak: `owned` iterates in session order, which a rewrite can reshuffle.
    if (
      candidateVisitedAt > bestVisitedAt ||
      (candidateVisitedAt === bestVisitedAt && best !== null && workspaceKey < best)
    ) {
      best = workspaceKey
      bestVisitedAt = candidateVisitedAt
    }
  }
  return best
}

function firstTabId(read: WorkspaceSessionState, workspaceKey: string): string | null {
  return read.tabsByWorktree?.[workspaceKey]?.[0]?.id ?? null
}
