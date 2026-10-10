import { describe, expect, it } from 'vitest'
import type { Project, ProjectHostSetup } from '../../shared/project-types'
import type { ResolvedWorktree } from './runtime-worktree-path-identity'
import { decideProjectPrimaryWorkspaceLifecycle } from './project-primary-workspace-lifecycle'

const project = (primaryWorkspace?: Project['primaryWorkspace']): Project => ({
  id: 'project-a',
  displayName: 'Project A',
  badgeColor: '#000',
  sourceRepoIds: ['repo-a', 'repo-b'],
  createdAt: 1,
  updatedAt: 1,
  ...(primaryWorkspace ? { primaryWorkspace } : {})
})

const setup = (id: string, repoId: string, hostId = 'local', createdAt = 1): ProjectHostSetup => ({
  id,
  projectId: 'project-a',
  repoId,
  hostId: hostId as ProjectHostSetup['hostId'],
  path: `/${repoId}`,
  displayName: repoId,
  setupState: 'ready',
  setupMethod: 'cloned',
  createdAt,
  updatedAt: createdAt
})

const worktree = (overrides: Partial<ResolvedWorktree> = {}): ResolvedWorktree =>
  ({
    id: 'repo-a::/repo-a',
    repoId: 'repo-a',
    path: '/repo-a',
    head: 'head',
    branch: 'main',
    isBare: false,
    isMainWorktree: true,
    instanceId: 'instance-a',
    hostId: 'local',
    ownerHostId: 'local',
    peerFingerprint: 'peer-a',
    git: { path: '/repo-a', head: 'head', branch: 'main', isBare: false, isMainWorktree: true },
    ...overrides
  }) as ResolvedWorktree

const options = {
  ownPeerFingerprint: 'peer-a',
  authorityFingerprint: 'peer-a',
  authoritativeRepoIds: new Set(['repo-a', 'repo-b']),
  isDesktopAuthority: true
}

describe('decideProjectPrimaryWorkspaceLifecycle', () => {
  it('seeds the original root before other candidates', () => {
    const selected = decideProjectPrimaryWorkspaceLifecycle(
      project(),
      [setup('setup-b', 'repo-b', 'ssh:target-a', 1), setup('setup-a', 'repo-a', 'local', 10)],
      [
        worktree({
          id: 'repo-b::/repo-b/child',
          repoId: 'repo-b',
          path: '/repo-b/child',
          hostId: 'ssh:target-a',
          ownerHostId: 'ssh:target-a',
          isMainWorktree: false,
          git: {
            path: '/repo-b/child',
            head: 'h',
            branch: 'b',
            isBare: false,
            isMainWorktree: false
          }
        }),
        worktree()
      ],
      options
    )

    expect(selected).toEqual({
      kind: 'write',
      primary: {
        worktreeId: 'repo-a::/repo-a',
        instanceId: 'instance-a',
        hostId: 'local',
        path: '/repo-a',
        peerFingerprint: 'peer-a',
        authorityFingerprint: 'peer-a'
      }
    })
  })

  it('treats undefined as legacy absence and explicit null as malformed saved state', () => {
    const legacy = { ...project(), primaryWorkspace: undefined }
    expect(
      decideProjectPrimaryWorkspaceLifecycle(
        legacy,
        [setup('setup-a', 'repo-a')],
        [worktree()],
        options
      ).kind
    ).toBe('write')

    const malformed = { ...project(), primaryWorkspace: null } as unknown as Project
    expect(
      decideProjectPrimaryWorkspaceLifecycle(
        malformed,
        [setup('setup-a', 'repo-a')],
        [worktree()],
        options
      )
    ).toEqual({ kind: 'unchanged' })
  })

  it('orders original roots by local host, oldest setup, and stable setup ID', () => {
    const local = worktree({
      id: 'repo-a::/local-child',
      path: '/local-child',
      isMainWorktree: true,
      git: { path: '/local-child', head: 'h', branch: 'b', isBare: false, isMainWorktree: true }
    })
    const ssh = worktree({
      id: 'repo-b::/ssh-child',
      repoId: 'repo-b',
      path: '/ssh-child',
      hostId: 'ssh:host-a',
      ownerHostId: 'ssh:host-a',
      isMainWorktree: true,
      git: { path: '/ssh-child', head: 'h', branch: 'b', isBare: false, isMainWorktree: true }
    })

    const localPreference = decideProjectPrimaryWorkspaceLifecycle(
      project(),
      [setup('ssh-old', 'repo-b', 'ssh:host-a', 1), setup('local-new', 'repo-a', 'local', 20)],
      [ssh, local],
      options
    )
    expect(localPreference).toMatchObject({ kind: 'write', primary: { worktreeId: local.id } })

    const otherLocal = worktree({
      id: 'repo-b::/other-local',
      repoId: 'repo-b',
      path: '/other-local',
      isMainWorktree: true,
      git: {
        path: '/other-local',
        head: 'h',
        branch: 'b',
        isBare: false,
        isMainWorktree: true
      }
    })
    const stableLocal = worktree({
      id: 'repo-c::/stable-local',
      repoId: 'repo-c',
      path: '/stable-local',
      isMainWorktree: true,
      git: {
        path: '/stable-local',
        head: 'h',
        branch: 'b',
        isBare: false,
        isMainWorktree: true
      }
    })
    expect(
      decideProjectPrimaryWorkspaceLifecycle(
        project(),
        [
          setup('setup-z', 'repo-a', 'local', 10),
          setup('setup-b', 'repo-b', 'local', 3),
          setup('setup-a', 'repo-c', 'local', 3)
        ],
        [local, otherLocal, stableLocal],
        { ...options, authoritativeRepoIds: new Set(['repo-a', 'repo-b', 'repo-c']) }
      )
    ).toMatchObject({ kind: 'write', primary: { worktreeId: stableLocal.id } })
  })

  it('does not seed a secondary workspace when no registered root is present', () => {
    const secondary = worktree({
      isMainWorktree: false,
      git: { path: '/feature', head: 'h', branch: 'feature', isBare: false, isMainWorktree: false }
    })
    expect(
      decideProjectPrimaryWorkspaceLifecycle(
        project(),
        [setup('setup-a', 'repo-a')],
        [secondary],
        options
      )
    ).toEqual({ kind: 'unchanged' })
  })

  it('refreshes rename locators for the same occupant and leaves replacements unresolved', () => {
    const saved = {
      worktreeId: 'repo-a::/old',
      instanceId: 'instance-a',
      hostId: 'local' as const,
      path: '/old',
      peerFingerprint: 'peer-a',
      authorityFingerprint: 'peer-a'
    }
    const renamed = worktree({ id: 'repo-a::/new', path: '/new' })
    expect(
      decideProjectPrimaryWorkspaceLifecycle(
        project(saved),
        [setup('setup-a', 'repo-a')],
        [renamed],
        options
      )
    ).toEqual({ kind: 'write', primary: { ...saved, worktreeId: renamed.id, path: renamed.path } })

    const replacement = worktree({ instanceId: 'instance-b', id: 'repo-a::/old' })
    expect(
      decideProjectPrimaryWorkspaceLifecycle(
        project(saved),
        [setup('setup-a', 'repo-a')],
        [replacement],
        options
      )
    ).toEqual({ kind: 'unchanged' })

    expect(
      decideProjectPrimaryWorkspaceLifecycle(
        project(saved),
        [setup('setup-a', 'repo-a')],
        [],
        options
      )
    ).toEqual({ kind: 'unchanged' })
  })

  it('does not seed malformed saved choices, non-authoritative rows, or headless peers', () => {
    expect(
      decideProjectPrimaryWorkspaceLifecycle(
        project({} as Project['primaryWorkspace']),
        [setup('s', 'repo-a')],
        [worktree()],
        options
      )
    ).toEqual({ kind: 'unchanged' })
    expect(
      decideProjectPrimaryWorkspaceLifecycle(project(), [setup('s', 'repo-a')], [worktree()], {
        ...options,
        authoritativeRepoIds: new Set()
      })
    ).toEqual({ kind: 'unchanged' })
    expect(
      decideProjectPrimaryWorkspaceLifecycle(project(), [setup('s', 'repo-a')], [worktree()], {
        ...options,
        isDesktopAuthority: false
      })
    ).toEqual({ kind: 'unchanged' })
    for (const authority of ['', 'different-peer']) {
      expect(
        decideProjectPrimaryWorkspaceLifecycle(
          { ...project(), primaryAuthorityFingerprint: authority },
          [setup('s', 'repo-a')],
          [worktree()],
          options
        )
      ).toEqual({ kind: 'unchanged' })
    }
    for (const malformedBinding of [null, 9, {}]) {
      expect(
        decideProjectPrimaryWorkspaceLifecycle(
          { ...project(), primaryAuthorityFingerprint: malformedBinding as never },
          [setup('s', 'repo-a')],
          [worktree()],
          options
        )
      ).toEqual({ kind: 'unchanged' })
    }
    const malformedRevision = project()
    malformedRevision.primaryWorkspaceRevision = -1
    expect(
      decideProjectPrimaryWorkspaceLifecycle(
        malformedRevision,
        [setup('s', 'repo-a')],
        [worktree()],
        options
      )
    ).toEqual({ kind: 'unchanged' })
    for (const row of [
      worktree({ isArchived: true }),
      worktree({ isBare: true }),
      worktree({ git: { ...worktree().git, prunable: true } })
    ]) {
      expect(
        decideProjectPrimaryWorkspaceLifecycle(project(), [setup('s', 'repo-a')], [row], options)
      ).toEqual({ kind: 'unchanged' })
    }
  })
})
