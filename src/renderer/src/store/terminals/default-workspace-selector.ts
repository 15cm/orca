import type { Project } from '../../../../shared/project-types'
import type { Worktree } from '../../../../shared/worktree/types'
import {
  hasSavedPrimaryWorkspace,
  resolveProjectPrimaryWorkspace
} from '../../../../shared/project-primary-workspace'

export function selectDefaultWorkspaceId(
  project: Project | undefined,
  worktrees: readonly Worktree[]
): string | null {
  if (project && hasSavedPrimaryWorkspace(project)) {
    return resolveProjectPrimaryWorkspace(project, worktrees)?.id ?? null
  }
  return worktrees.find((worktree) => worktree.isMainWorktree)?.id ?? worktrees[0]?.id ?? null
}
