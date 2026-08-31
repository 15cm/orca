/**
 * Which workspaces a window serves, derived in main from the window's scope.
 *
 * Main is the authority on a window's scope (see docs/reference/per-window-view-state.md), so it
 * resolves this rather than trusting a renderer-declared list: a stale or wrong list would let
 * one window overwrite another's tabs, and the renderer cannot know the answer at hydration time
 * anyway — project groups load in parallel with the session read.
 */
import { getProjectGroupSubtreeIds } from '../../shared/project-groups'
import {
  resolveWorkspaceProjectGroupId,
  type WorkspaceProjectGroupSources
} from '../../shared/workspace-project-group'
import type { ProjectGroup } from '../../shared/project-group-types'
import type { WindowScope } from '../../shared/window-scope'
import type { WorkspaceSessionState } from '../../shared/workspace-session-state-types'
import { collectWorkspaceSessionWorktreeKeys } from '../../shared/workspace-session-window-rebase'

/**
 * The session keys of a scope's project group, subgroups included.
 *
 * Every kind of workspace goes through `resolveWorkspaceProjectGroupId`: a git worktree is placed
 * by its repo, a folder workspace by the group it carries itself. Reading the repo id out of the
 * key would drop every `folder:<id>` — the project's own terminals — on the floor.
 */
export function resolveScopeSessionKeys(
  scope: WindowScope,
  session: WorkspaceSessionState,
  sources: WorkspaceProjectGroupSources & {
    getProjectGroups: () => readonly Pick<ProjectGroup, 'id' | 'parentGroupId'>[]
  }
): Set<string> {
  const groupIds = getProjectGroupSubtreeIds(sources.getProjectGroups(), scope.projectGroupId)
  const owned = new Set<string>()
  for (const key of collectWorkspaceSessionWorktreeKeys(session)) {
    const groupId = resolveWorkspaceProjectGroupId(sources, key)
    if (groupId !== null && groupIds.has(groupId)) {
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
