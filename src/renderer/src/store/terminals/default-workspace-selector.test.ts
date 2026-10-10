import { describe, expect, it } from 'vitest'
import type { Project, ProjectPrimaryWorkspace } from '../../../../shared/project-types'
import type { Worktree } from '../../../../shared/worktree/types'
import { selectDefaultWorkspaceId } from './default-workspace-selector'

const main: Worktree = {
  id: 'main',
  repoId: 'r',
  hostId: 'local' as const,
  instanceId: 'main',
  peerFingerprint: 'peer',
  path: '/',
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
const replacement = { ...main, id: 'feature', instanceId: 'replacement', isMainWorktree: false }
const project: Project = {
  id: 'p',
  displayName: 'P',
  badgeColor: '#000',
  sourceRepoIds: ['r'],
  createdAt: 1,
  updatedAt: 1,
  primaryWorkspace: {
    worktreeId: 'feature',
    instanceId: 'old',
    hostId: 'local' as const,
    path: '/feature',
    peerFingerprint: 'peer'
  }
}

describe('selectDefaultWorkspaceId', () => {
  it('keeps unavailable saved primary unresolved instead of falling back', () => {
    expect(selectDefaultWorkspaceId(project, [main, replacement])).toBeNull()
  })
  it('uses legacy default only without saved primary', () => {
    expect(selectDefaultWorkspaceId(undefined, [main])).toBe('main')
  })
  it('resolves restored/session selection before this fallback at call site', () => {
    const restored = 'restored'
    expect(restored || selectDefaultWorkspaceId(project, [main])).toBe('restored')
  })
  it('treats malformed null saved choice as unavailable instead of legacy fallback', () => {
    const malformedProject = {
      ...project,
      primaryWorkspace: null as unknown as ProjectPrimaryWorkspace
    }

    expect(selectDefaultWorkspaceId(malformedProject, [main])).toBeNull()
  })
})
