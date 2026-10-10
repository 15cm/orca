import { describe, expect, it } from 'vitest'
import type { ProjectPrimaryWorkspace } from '../../../../shared/project-types'
import type { Worktree } from '../../../../shared/worktree/types'
import { getDefaultWorktree } from './automation-draft-model'

const main: Worktree = {
  id: 'r::/main',
  repoId: 'r',
  projectId: 'p',
  hostId: 'local' as const,
  instanceId: 'main',
  peerFingerprint: 'peer',
  path: '/main',
  head: 'abc',
  branch: 'refs/heads/main',
  isBare: false,
  isMainWorktree: true,
  displayName: 'main',
  comment: '',
  linkedIssue: null,
  linkedPR: null,
  linkedLinearIssue: null,
  isArchived: false,
  isUnread: false,
  isPinned: false,
  sortOrder: 0,
  lastActivityAt: 0
}
const primary: Worktree = {
  ...main,
  id: 'r::/primary',
  instanceId: 'primary',
  path: '/primary',
  isMainWorktree: false
}
const project = {
  id: 'p',
  displayName: 'P',
  badgeColor: '#000',
  sourceRepoIds: ['r'],
  createdAt: 1,
  updatedAt: 1,
  primaryWorkspace: {
    worktreeId: primary.id,
    instanceId: 'primary',
    hostId: 'local' as const,
    path: primary.path,
    peerFingerprint: 'peer',
    authorityFingerprint: 'authority'
  }
}

describe('automation existing workspace defaults', () => {
  it('chooses configured primary before original checkout when no explicit workspace is supplied', () => {
    expect(getDefaultWorktree([main, primary], [project])?.instanceId).toBe('primary')
  })

  it('retains original checkout fallback if no resolvable primary is configured', () => {
    expect(getDefaultWorktree([main, primary], [])?.instanceId).toBe('main')
  })

  it('does not fall back when saved primary instance is unavailable or replaced', () => {
    const replaced = { ...primary, instanceId: 'replacement' }
    expect(getDefaultWorktree([main, replaced], [project])).toBeNull()
  })

  it('treats malformed null saved choice as unavailable instead of legacy fallback', () => {
    const malformedProject = {
      ...project,
      primaryWorkspace: null as unknown as ProjectPrimaryWorkspace
    }

    expect(getDefaultWorktree([main, primary], [malformedProject])).toBeNull()
  })

  it('returns exact authenticated peer row when catalog duplicates id, host, and instance', () => {
    const otherPeer = { ...primary, peerFingerprint: 'other-peer' }
    expect(getDefaultWorktree([otherPeer, primary], [project])).toBe(primary)
  })
})
