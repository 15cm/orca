/**
 * Which worktrees a window writes for, derived in main from the window's scope.
 *
 * Main is the authority on a window's scope (see docs/reference/per-window-view-state.md), so it
 * resolves this rather than trusting a renderer-declared list: a stale or wrong list would let
 * one window overwrite another's tabs, and the renderer cannot know the answer at hydration time
 * anyway — project groups load in parallel with the session read.
 */
import { getProjectGroupSubtreeIds } from '../../shared/project-groups'
import { getRepoIdFromWorktreeId } from '../../shared/worktree/id'
import { parseWorkspaceKey } from '../../shared/workspace-scope'
import type { ProjectGroup } from '../../shared/project-group-types'
import type { Repo } from '../../shared/repo-types'
import type { WindowScope } from '../../shared/window-scope'
import type { WorkspaceSessionState } from '../../shared/workspace-session-state-types'
import { collectWorkspaceSessionWorktreeKeys } from '../../shared/workspace-session-window-rebase'

/** The repos of a scope's project group, subgroups included. */
export function resolveScopeRepoIds(
  scope: WindowScope,
  repos: readonly Pick<Repo, 'id' | 'projectGroupId'>[],
  groups: readonly Pick<ProjectGroup, 'id' | 'parentGroupId'>[]
): Set<string> {
  const groupIds = getProjectGroupSubtreeIds(groups, scope.projectGroupId)
  const repoIds = new Set<string>()
  for (const repo of repos) {
    if (repo.projectGroupId && groupIds.has(repo.projectGroupId)) {
      repoIds.add(repo.id)
    }
  }
  return repoIds
}

/** Session keys are worktree ids (or workspace keys wrapping one), and a worktree id carries its repo. */
export function resolveScopeWorktreeIds(
  session: WorkspaceSessionState,
  scopeRepoIds: ReadonlySet<string>
): Set<string> {
  const owned = new Set<string>()
  if (scopeRepoIds.size === 0) {
    return owned
  }
  for (const key of collectWorkspaceSessionWorktreeKeys(session)) {
    const parsed = parseWorkspaceKey(key)
    const worktreeId = parsed?.type === 'worktree' ? parsed.worktreeId : key
    if (scopeRepoIds.has(getRepoIdFromWorktreeId(worktreeId))) {
      owned.add(key)
    }
  }
  return owned
}

/**
 * The scopes other live windows are serving. The shared window reads everything except these,
 * so a project that has its own window stops appearing in the window it was opened from.
 */
export function resolveScopesServedByOtherWindows(
  senderWebContentsId: number | undefined,
  windows: readonly { webContents: { id: number } }[],
  resolveScope: (webContentsId: number) => WindowScope | null
): WindowScope[] {
  const scopes: WindowScope[] = []
  for (const window of windows) {
    const webContentsId = window.webContents.id
    if (webContentsId === senderWebContentsId) {
      continue
    }
    const scope = resolveScope(webContentsId)
    if (scope) {
      scopes.push(scope)
    }
  }
  return scopes
}
