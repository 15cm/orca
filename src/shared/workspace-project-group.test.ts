import { describe, expect, it } from 'vitest'
import { resolveWorkspaceProjectGroupId } from './workspace-project-group'

const PERC_GROUP = 'group-perc'
const PERC_WORKTREE = 'perc-repo::/tmp/perc/main'
const PERC_FOLDER_WORKSPACE = 'folder:perc-tasks'
const ORPHAN_WORKTREE = 'orphan-repo::/tmp/orphan'

describe('resolveWorkspaceProjectGroupId', () => {
  const sources = {
    getRepo: (repoId: string) =>
      repoId === 'perc-repo'
        ? { projectGroupId: PERC_GROUP }
        : repoId === 'loose-repo'
          ? { projectGroupId: null }
          : undefined,
    getFolderWorkspaces: () => [{ id: 'perc-tasks', projectGroupId: PERC_GROUP }]
  }

  it('reads a git worktree group through its repo', () => {
    expect(resolveWorkspaceProjectGroupId(sources, PERC_WORKTREE)).toBe(PERC_GROUP)
    expect(resolveWorkspaceProjectGroupId(sources, `worktree:${PERC_WORKTREE}`)).toBe(PERC_GROUP)
  })

  it('reads a folder workspace group directly', () => {
    expect(resolveWorkspaceProjectGroupId(sources, PERC_FOLDER_WORKSPACE)).toBe(PERC_GROUP)
  })

  it('returns null for ungrouped, unknown or malformed ids', () => {
    expect(resolveWorkspaceProjectGroupId(sources, 'loose-repo::/tmp/loose')).toBeNull()
    expect(resolveWorkspaceProjectGroupId(sources, ORPHAN_WORKTREE)).toBeNull()
    expect(resolveWorkspaceProjectGroupId(sources, 'folder:missing')).toBeNull()
    expect(resolveWorkspaceProjectGroupId(sources, 'no-separator')).toBeNull()
  })
})
