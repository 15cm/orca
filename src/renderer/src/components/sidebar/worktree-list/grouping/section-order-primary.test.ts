import { describe, expect, it } from 'vitest'
import type { Project, ProjectPrimaryWorkspace } from '../../../../../../shared/project-types'
import type { Worktree } from '../../../../../../shared/worktree/types'
import { orderMainWorktreeFirst } from './section-order'

const project: Project = {
  id: 'project',
  displayName: 'Project',
  badgeColor: '#000',
  sourceRepoIds: ['repo'],
  createdAt: 1,
  updatedAt: 1,
  primaryWorkspace: {
    worktreeId: 'same',
    instanceId: 'instance',
    hostId: 'local',
    path: '/primary',
    peerFingerprint: 'selected-peer',
    authorityFingerprint: 'authority'
  }
}

function makeWorktree(overrides: Partial<Worktree> & { path: string }): Worktree {
  return {
    id: 'same',
    repoId: 'repo',
    head: 'abc',
    branch: 'refs/heads/main',
    isBare: false,
    isMainWorktree: false,
    displayName: 'workspace',
    comment: '',
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 0,
    hostId: 'local',
    instanceId: 'instance',
    peerFingerprint: 'selected-peer',
    ...overrides
  }
}

function index(projectValue: Project): NonNullable<Parameters<typeof orderMainWorktreeFirst>[1]> {
  return {
    projectById: new Map([[projectValue.id, projectValue]]),
    setupByRepoId: new Map(),
    surfaceKeysRequiringSetupGroups: new Set()
  }
}

describe('project primary workspace section ordering', () => {
  it('orders exact peer row first when duplicate peers share host, id, and instance', () => {
    const original = makeWorktree({
      path: '/original',
      isMainWorktree: true,
      peerFingerprint: 'old'
    })
    const selected = makeWorktree({ path: '/primary', peerFingerprint: 'selected-peer' })

    expect(orderMainWorktreeFirst([original, selected], index(project))).toEqual([
      selected,
      original
    ])
  })

  it('does not promote original checkout when saved primary is unavailable', () => {
    const original = makeWorktree({
      path: '/original',
      isMainWorktree: true,
      peerFingerprint: 'old-peer'
    })
    const child = makeWorktree({
      id: 'child',
      path: '/child',
      instanceId: 'child-instance',
      peerFingerprint: 'other'
    })

    expect(orderMainWorktreeFirst([child, original], index(project))).toEqual([child, original])
  })

  it('does not promote original checkout when malformed saved primary is null', () => {
    const original = makeWorktree({ path: '/original', isMainWorktree: true })
    const child = makeWorktree({
      id: 'child',
      path: '/child',
      instanceId: 'child-instance',
      peerFingerprint: 'other'
    })
    const malformedProject = {
      ...project,
      primaryWorkspace: null as unknown as ProjectPrimaryWorkspace
    }

    expect(orderMainWorktreeFirst([original, child], index(malformedProject))).toEqual([
      original,
      child
    ])
  })

  it('retains original checkout first for a legacy project without a saved selection', () => {
    const original = makeWorktree({ path: '/original', isMainWorktree: true })
    const child = makeWorktree({ id: 'child', path: '/child', instanceId: 'child-instance' })
    const legacyProject = { ...project, primaryWorkspace: undefined }

    expect(orderMainWorktreeFirst([child, original], index(legacyProject))).toEqual([
      original,
      child
    ])
  })

  it('keeps unavailable configured originals after legacy mains in mixed sections', () => {
    const configuredOriginal = makeWorktree({
      path: '/configured-original',
      isMainWorktree: true,
      projectId: 'project'
    })
    const configuredChild = makeWorktree({
      id: 'configured-child',
      path: '/configured-child',
      instanceId: 'configured-child-instance',
      projectId: 'project'
    })
    const legacyOriginal = makeWorktree({
      id: 'legacy-main',
      repoId: 'legacy-repo',
      path: '/legacy-main',
      isMainWorktree: true,
      projectId: 'legacy-project'
    })
    const legacyProject: Project = {
      ...project,
      id: 'legacy-project',
      sourceRepoIds: ['legacy-repo'],
      primaryWorkspace: undefined
    }
    const mixedIndex = {
      ...index(project),
      projectById: new Map([
        [project.id, project],
        [legacyProject.id, legacyProject]
      ])
    }

    expect(
      orderMainWorktreeFirst(
        [configuredChild, configuredOriginal, legacyOriginal],
        mixedIndex
      )
    ).toEqual([legacyOriginal, configuredChild, configuredOriginal])
  })
})
