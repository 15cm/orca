import { describe, expect, it, vi } from 'vitest'
import type { PrimaryRemovalReservation } from './project-primary-mutation-gate'
import { RuntimeProjectPrimaryRemovalController } from './runtime-project-primary-removal-controller'
import { RuntimeProjectHostSetupController } from './runtime-project-host-setup-controller'
import { getProjectHostSetupForRepo } from '../../shared/project-host-setup-lookup'
import type { Repo } from '../../shared/repo-types'
import type { Project } from '../../shared/project-types'

describe('RuntimeProjectPrimaryRemovalController', () => {
  it('forwards removal authorization through every bound project for a shared repo', async () => {
    const calls: string[] = []
    const project = (id: string) => ({ id, primaryAuthorityFingerprint: 'desktop-peer' })
    const store = {
      getProjects: () => [project('project-a'), project('project-b')],
      getProjectHostSetups: () => [
        { id: 'setup-a', projectId: 'project-a', repoId: 'repo-a', hostId: 'runtime:peer' },
        { id: 'setup-b', projectId: 'project-b', repoId: 'repo-a', hostId: 'runtime:peer' }
      ]
    }
    const controller = new RuntimeProjectPrimaryRemovalController({
      getStore: () => store as never,
      isDesktopAuthority: () => false,
      listResolvedWorktrees: async () => [],
      getOwnPeerFingerprint: () => 'peer-a',
      forwardProjectRemovalAuthorization: async (projectId, _repoId, operation) => {
        calls.push(`begin:${projectId}`)
        const result = await operation()
        calls.push(`finish:${projectId}`)
        return result
      }
    })
    const operation = vi.fn(async () => 'removed')

    await expect(controller.guardProjectRemoval('repo-a', 'runtime:peer', operation)).resolves.toBe(
      'removed'
    )
    expect(calls).toEqual([
      'begin:project-a',
      'begin:project-b',
      'finish:project-b',
      'finish:project-a'
    ])
    expect(operation).toHaveBeenCalledOnce()
  })

  it('uses catalog repo and occupant identity to protect folder setup deletion', async () => {
    const project = {
      id: 'project-a',
      primaryWorkspace: {
        worktreeId: 'folder-repo::/workspace/root',
        hostId: 'local',
        instanceId: 'folder-instance',
        peerFingerprint: 'peer-a'
      }
    }
    const setup = { id: 'setup-a', projectId: 'project-a', repoId: 'folder-repo', hostId: 'local' }
    const remove = vi.fn(async () => 'removed')
    const reservations: PrimaryRemovalReservation[] = []
    const store = {
      getProjects: () => [project],
      getProjectHostSetups: () => [setup],
      getPrimaryRemovalReservations: () => reservations,
      savePrimaryRemovalReservation: async (reservation: PrimaryRemovalReservation) => {
        reservations.push(reservation)
      },
      removePrimaryRemovalReservation: async (token: string) => {
        const index = reservations.findIndex((entry) => entry.token === token)
        if (index !== -1) {
          reservations.splice(index, 1)
        }
      }
    }
    const controller = new RuntimeProjectPrimaryRemovalController({
      getStore: () => store as never,
      isDesktopAuthority: () => true,
      listResolvedWorktrees: async () => [],
      getOwnPeerFingerprint: () => 'peer-a'
    })

    await expect(controller.guardSetupRemoval('setup-a', remove)).rejects.toThrow(
      'primary_selected'
    )
    expect(remove).not.toHaveBeenCalled()
  })

  it('protects the saved authenticated setup owner when its catalog row is unavailable', async () => {
    const setup = {
      id: 'runtime:peer-a::setup-a',
      projectId: 'project-a',
      repoId: 'repo-a',
      hostId: 'runtime:peer-a',
      runtimeOwnerEnvironmentId: 'peer-a',
      runtimeOwnerFingerprint: 'peer-a-fingerprint',
      runtimeOwnerHostId: 'ssh:connection-a'
    }
    const project = {
      id: 'project-a',
      primaryAuthorityFingerprint: 'desktop-a',
      primaryWorkspace: {
        worktreeId: 'repo-a::/repo-a/worktree',
        instanceId: 'instance-a',
        hostId: 'ssh:connection-a',
        path: '/repo-a/worktree',
        peerFingerprint: 'peer-a-fingerprint',
        authorityFingerprint: 'desktop-a'
      }
    }
    const store = {
      getProjects: () => [project],
      getProjectHostSetups: () => [setup],
      getPrimaryRemovalReservations: () => []
    }
    const controller = new RuntimeProjectPrimaryRemovalController({
      getStore: () => store as never,
      isDesktopAuthority: () => true,
      listResolvedWorktrees: async () => [],
      listAuthenticatedRuntimeWorktrees: async () => [],
      getOwnPeerFingerprint: () => 'desktop-a'
    })
    const remove = vi.fn(async () => 'removed')

    await expect(controller.guardSetupRemoval(setup.id, remove)).rejects.toThrow(
      'primary_selected'
    )
    expect(remove).not.toHaveBeenCalled()
  })

  it('allows a same repo id on a different authenticated setup owner', async () => {
    const setup = {
      id: 'runtime:peer-a::setup-a',
      projectId: 'project-a',
      repoId: 'repo-a',
      hostId: 'runtime:peer-a',
      runtimeOwnerEnvironmentId: 'peer-a',
      runtimeOwnerFingerprint: 'peer-a-fingerprint',
      runtimeOwnerHostId: 'ssh:connection-a'
    }
    const project = {
      id: 'project-a',
      primaryAuthorityFingerprint: 'desktop-a',
      primaryWorkspace: {
        worktreeId: 'repo-a::/repo-a/worktree',
        instanceId: 'instance-b',
        hostId: 'ssh:connection-b',
        path: '/repo-a/worktree',
        peerFingerprint: 'peer-b-fingerprint',
        authorityFingerprint: 'desktop-a'
      }
    }
    const store = {
      getProjects: () => [project],
      getProjectHostSetups: () => [setup],
      getPrimaryRemovalReservations: () => []
    }
    const controller = new RuntimeProjectPrimaryRemovalController({
      getStore: () => store as never,
      isDesktopAuthority: () => true,
      listResolvedWorktrees: async () => [],
      listAuthenticatedRuntimeWorktrees: async () => [],
      getOwnPeerFingerprint: () => 'desktop-a'
    })

    await expect(controller.guardSetupRemoval(setup.id, async () => 'removed')).resolves.toBe(
      'removed'
    )
  })

  it('requires token and owner proof before recording removal completion', async () => {
    const reservations: PrimaryRemovalReservation[] = []
    const store = {
      getProjects: () => [{ id: 'project-a' }],
      getRepos: () => [],
      getProjectHostSetups: () => [
        { id: 'setup-a', projectId: 'project-a', repoId: 'repo-a', hostId: 'local' }
      ],
      getPrimaryRemovalReservations: () => reservations,
      savePrimaryRemovalReservation: async (reservation: PrimaryRemovalReservation) =>
        reservations.push(reservation),
      removePrimaryRemovalReservation: async (token: string) => {
        const index = reservations.findIndex((entry) => entry.token === token)
        if (index !== -1) {
          reservations.splice(index, 1)
        }
      }
    }
    const controller = new RuntimeProjectPrimaryRemovalController({
      getStore: () => store as never,
      isDesktopAuthority: () => true,
      listResolvedWorktrees: async () => [
        {
          id: 'repo-a::/repo-a',
          repoId: 'repo-a',
          hostId: 'local',
          instanceId: 'i-1',
          path: '/repo-a',
          peerFingerprint: 'peer-a',
          isArchived: false,
          git: { isBare: false, prunable: false, isMainWorktree: false }
        } as never
      ],
      getOwnPeerFingerprint: () => 'peer-a',
      verifyAuthoritativeWorktree: async () => true
    })
    const owner = { peerFingerprint: 'peer-a', hostId: 'local', instanceId: 'i-1' }
    const token = await controller.beginRemoval('project-a', owner)

    await expect(controller.recordCompletion('unknown-token', owner)).rejects.toMatchObject({
      code: 'unknown_removal_token'
    })
    await expect(
      controller.recordCompletion(token, { ...owner, instanceId: 'other' })
    ).rejects.toMatchObject({ code: 'owner_mismatch' })
    expect(await controller.finishRemoval(token, owner)).toBe(false)
    await controller.recordCompletion(token, owner)
    await expect(controller.finishRemoval(token, owner)).resolves.toBe(true)
  })

  it('preserves unbound headless setup deletion and denies saved primary state', async () => {
    const setup = { id: 'setup-a', projectId: 'project-a', repoId: 'repo-a', hostId: 'local' }
    let projects: object[] = [{ id: 'project-a' }]
    const store = {
      getProjects: () => projects,
      getProjectHostSetups: () => [setup],
      getPrimaryRemovalReservations: () => [],
      savePrimaryRemovalReservation: async () => undefined,
      removePrimaryRemovalReservation: async () => undefined
    }
    const controller = new RuntimeProjectPrimaryRemovalController({
      getStore: () => store as never,
      isDesktopAuthority: () => false,
      listResolvedWorktrees: async () => [],
      getOwnPeerFingerprint: () => null
    })
    const remove = vi.fn(async () => 'removed')

    await expect(controller.guardSetupRemoval('setup-a', remove)).resolves.toBe('removed')
    projects = [
      { id: 'project-a', primaryWorkspace: { worktreeId: 'repo-a::/gone', hostId: 'local' } }
    ]
    await expect(controller.guardSetupRemoval('setup-a', remove)).rejects.toThrow(
      'authority_unavailable'
    )
    expect(remove).toHaveBeenCalledOnce()
  })

  it('serializes setup deletion before promotion and promotion before deletion', async () => {
    const repo = {
      id: 'repo-a',
      path: '/repo-a',
      displayName: 'repo',
      badgeColor: '#000',
      addedAt: 1,
      kind: 'git'
    } as unknown as Repo
    const project: Project = {
      id: 'project-a',
      displayName: 'repo',
      badgeColor: '#000',
      sourceRepoIds: ['repo-a'],
      createdAt: 1,
      updatedAt: 1,
      primaryWorkspace: undefined
    }
    const setup = {
      id: 'setup-a',
      projectId: 'project-a',
      repoId: 'repo-a',
      hostId: 'local',
      setupState: 'ready'
    }
    const worktree = {
      id: 'repo-a::/repo-a',
      repoId: 'repo-a',
      hostId: 'local',
      instanceId: 'instance-a',
      path: '/repo-a',
      peerFingerprint: 'peer-a',
      isArchived: false,
      git: { isBare: false, prunable: false }
    }
    const setups = [setup]
    const reservations: PrimaryRemovalReservation[] = []
    let deleteSetupImpl: () => Promise<unknown> = async () => {
      setups.splice(0)
      return { project, setup, repo }
    }
    const store = {
      getProjects: () => [project],
      getProjectHostSetups: () => setups,
      getPrimaryRemovalReservations: () => reservations,
      savePrimaryRemovalReservation: async (reservation: PrimaryRemovalReservation) =>
        reservations.push(reservation),
      removePrimaryRemovalReservation: async () => undefined,
      setPrimaryWorkspaceDurably: async (_id: string, primary: unknown) => {
        Object.assign(project, { primaryWorkspace: primary })
        return project
      },
      bindPrimaryAuthorityFingerprintDurably: async (_id: string, fingerprint: string) => {
        Object.assign(project, { primaryAuthorityFingerprint: fingerprint })
        return project
      },
      deleteProjectHostSetup: async () => deleteSetupImpl()
    }
    const removal = new RuntimeProjectPrimaryRemovalController({
      getStore: () => store as never,
      isDesktopAuthority: () => true,
      listResolvedWorktrees: async () => [worktree as never],
      getOwnPeerFingerprint: () => 'peer-a'
    })
    let markPromotionQueued!: () => void
    const promotionQueued = new Promise<void>((resolve) => {
      markPromotionQueued = resolve
    })
    const controller = new RuntimeProjectHostSetupController({
      getStore: () => store as never,
      listRepos: () => [repo],
      addRepo: vi.fn(),
      addRemoteRepo: vi.fn(),
      cloneRepo: vi.fn(),
      invalidateResolvedWorktrees: vi.fn(),
      invalidateWorktreeScan: vi.fn(),
      notifyReposChanged: vi.fn(),
      listResolvedWorktrees: async () => [worktree as never],
      verifyAuthoritativeWorktree: async () => true,
      getOwnPeerFingerprint: () => 'peer-a',
      runPrimaryMutation: (projectId, target, operation) => {
        markPromotionQueued()
        return removal.runPrimaryMutation(projectId, target, operation)
      },
      flushPrimaryPersistence: async () => undefined,
      guardSetupRemoval: removal.guardSetupRemoval.bind(removal)
    })
    const projectId = getProjectHostSetupForRepo([], repo).projectId
    // The test's repo identity is explicit so setup, selector and mutation share the same project.
    Object.assign(project, { id: projectId })
    Object.assign(setup, { projectId })
    const deleteArgs = { setupId: 'setup-a' }
    let enterDelete!: () => void
    let releaseDelete!: () => void
    const deleteEntered = new Promise<void>((resolve) => {
      enterDelete = resolve
    })
    const deleteHold = new Promise<void>((resolve) => {
      releaseDelete = resolve
    })
    deleteSetupImpl = async () => {
      enterDelete()
      await deleteHold
      setups.splice(0)
      return { project, setup, repo }
    }
    const deleting = controller.deleteSetup(deleteArgs)
    await deleteEntered
    const stalePromotion = controller.setPrimaryWorkspace({
      projectId,
      worktree: 'id:repo-a::/repo-a'
    })
    await promotionQueued
    releaseDelete()
    await deleting
    await expect(stalePromotion).rejects.toThrow('primary_workspace_unavailable')
    expect(project.primaryWorkspace).toBeUndefined()

    setups.push(setup)
    project.primaryWorkspace = undefined
    deleteSetupImpl = async () => {
      setups.splice(0)
      return { project, setup, repo }
    }
    await controller.setPrimaryWorkspace({ projectId, worktree: 'id:repo-a::/repo-a' })
    await expect(controller.deleteSetup(deleteArgs)).rejects.toThrow('primary_selected')
    expect(setups).toHaveLength(1)
  })
})
