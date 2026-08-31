import type { FolderWorkspace } from './folder-workspace-types'
import type { Repo } from './repo-types'
import { parseWorkspaceKey } from './workspace-scope'
import { splitWorktreeId } from './worktree/id'

/**
 * The one rule placing a workspace in a project group, shared by everything that partitions
 * state along the window axis: PTY ownership (`main/runtime/window-pty-ownership-priority`) and
 * the session keys a project window serves (`main/window/window-scoped-session-keys`).
 *
 * It lives here because a second copy is exactly how folder workspaces got lost: a rule written
 * as "the repo id inside a worktree id" silently places every `folder:<id>` key nowhere.
 */

export type WorkspaceProjectGroupSources = {
  getRepo: (repoId: string) => Pick<Repo, 'projectGroupId'> | undefined
  getFolderWorkspaces: () => readonly Pick<FolderWorkspace, 'id' | 'projectGroupId'>[]
}

/**
 * A folder workspace carries its group directly; a git worktree inherits its repo's. Anything
 * else (unknown repo, ungrouped repo, an id that parses as neither) is null and belongs to no
 * project window.
 */
export function resolveWorkspaceProjectGroupId(
  sources: WorkspaceProjectGroupSources,
  workspaceKey: string
): string | null {
  const workspace = parseWorkspaceKey(workspaceKey)
  if (workspace?.type === 'folder') {
    const folderWorkspace = sources
      .getFolderWorkspaces()
      .find((candidate) => candidate.id === workspace.folderWorkspaceId)
    return folderWorkspace?.projectGroupId ?? null
  }
  if (workspace?.type === 'worktree') {
    return resolveWorkspaceProjectGroupId(sources, workspace.worktreeId)
  }
  const parsed = splitWorktreeId(workspaceKey)
  if (!parsed?.repoId) {
    return null
  }
  return sources.getRepo(parsed.repoId)?.projectGroupId ?? null
}
