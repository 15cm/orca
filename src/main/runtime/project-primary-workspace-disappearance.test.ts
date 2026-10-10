import { describe, expect, it, vi } from 'vitest'
import { fenceObservedMissingPrimaryWorktree } from './project-primary-workspace-disappearance'

describe('fenceObservedMissingPrimaryWorktree', () => {
  it('treats bare and prunable rows as absent while retaining the saved selection', () => {
    const primary = {
      worktreeId: 'repo-a::/gone',
      instanceId: 'old-instance',
      hostId: 'local' as const,
      path: '/gone',
      peerFingerprint: 'peer-a',
      authorityFingerprint: 'peer-a'
    }
    const project = {
      id: 'project-a',
      primaryAuthorityFingerprint: 'peer-a',
      primaryWorkspace: primary
    }
    const write = vi.fn()
    const store = {
      getProjects: () => [project],
      getWorktreeMetaForHost: () => ({ instanceId: 'old-instance' }),
      setWorktreeMetaForHost: write,
      setWorktreeMeta: write
    }

    fenceObservedMissingPrimaryWorktree(
      store as never,
      { id: 'repo-a', path: '/repo' } as never,
      [
        { path: '/gone', isBare: false, prunable: true },
        { path: '/gone', isBare: true, prunable: false }
      ],
      'peer-a'
    )

    expect(write).toHaveBeenCalledWith('repo-a::/gone', 'local', {
      instanceId: expect.not.stringMatching(/^old-instance$/)
    })
    expect(project.primaryWorkspace).toBe(primary)
  })
})
