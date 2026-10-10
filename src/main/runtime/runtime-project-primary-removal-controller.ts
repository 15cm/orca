import type { PrimaryWorkspaceTarget } from '../../shared/project-primary-removal'
import type { Project } from '../../shared/project-types'
import type { RuntimeStore } from './runtime-store-contract'
import type { ResolvedWorktree } from './runtime-worktree-path-identity'
import { ProjectPrimaryMutationGate } from './project-primary-mutation-gate'
import { parseExecutionHostId } from '../../shared/execution-host'
import { isFolderRepo } from '../../shared/repo-kind'

type Dependencies = {
  getStore: () => RuntimeStore | null
  isDesktopAuthority: () => boolean
  listResolvedWorktrees: () => Promise<ResolvedWorktree[]>
  listAuthenticatedRuntimeWorktrees?: (
    projectId: string,
    environmentId: string
  ) => Promise<ResolvedWorktree[]>
  verifyAuthoritativeWorktree?: (worktree: ResolvedWorktree) => Promise<boolean>
  getOwnPeerFingerprint: () => string | null
  forwardRemovalBegin?: (projectId: string, target: PrimaryWorkspaceTarget) => Promise<string>
  forwardRemovalFinish?: (
    projectId: string,
    token: string,
    target: PrimaryWorkspaceTarget
  ) => Promise<void>
  forwardSetupRemovalAuthorization?: <T>(
    projectId: string,
    setupId: string,
    operation: () => Promise<T>
  ) => Promise<T>
  forwardProjectRemovalAuthorization?: <T>(
    projectId: string,
    repoId: string,
    operation: () => Promise<T>
  ) => Promise<T>
}

function sameTarget(left: PrimaryWorkspaceTarget, right: PrimaryWorkspaceTarget): boolean {
  return (
    left.peerFingerprint === right.peerFingerprint &&
    left.hostId === right.hostId &&
    left.instanceId === right.instanceId
  )
}

export class RuntimeProjectPrimaryRemovalController {
  private gate: ProjectPrimaryMutationGate | null = null
  private readonly completedTokens = new Map<string, PrimaryWorkspaceTarget>()
  private readonly forwardedProjectByToken = new Map<string, string>()
  private readonly forwardedTargetByToken = new Map<string, PrimaryWorkspaceTarget>()

  constructor(private readonly deps: Dependencies) {}

  runPrimaryMutation<T>(
    projectId: string,
    target: PrimaryWorkspaceTarget,
    operation: () => Promise<T>
  ): Promise<T> {
    return this.getGate().withPrimaryChange(projectId, target, operation)
  }

  async guardSetupRemoval<T>(
    setupId: string,
    operation: () => Promise<T>,
    expectedHostId?: string
  ): Promise<T> {
    const store = this.requireStore()
    const setup = store.getProjectHostSetups?.().find((entry) => entry.id === setupId)
    if (!setup) {
      throw new Error(`Project host setup not found: ${setupId}`)
    }
    const project = store.getProjects?.().find((entry) => entry.id === setup.projectId)
    if (!project) {
      throw new Error(`Project not found: ${setup.projectId}`)
    }
    if (expectedHostId && setup.hostId !== expectedHostId) {
      throw new Error('primary_workspace_owner_mismatch')
    }
    const authorityBound = Object.hasOwn(project, 'primaryAuthorityFingerprint')
    if (authorityBound && !this.deps.isDesktopAuthority()) {
      if (!this.deps.forwardSetupRemovalAuthorization) {
        throw new Error('primary_authority_unavailable')
      }
      return this.deps.forwardSetupRemovalAuthorization(project.id, setupId, operation)
    }
    return this.getGate().withProjectLock(project.id, async () => {
      await this.assertSetupRemovalAllowed(project.id, setupId, expectedHostId)
      return operation()
    })
  }

  async guardProjectRemoval<T>(
    repoId: string,
    hostId: string | undefined,
    operation: () => Promise<T>
  ): Promise<T> {
    const store = this.requireStore()
    const setups =
      store
        .getProjectHostSetups?.()
        .filter((entry) => entry.repoId === repoId && (!hostId || entry.hostId === hostId)) ?? []
    const projectIds = [...new Set(setups.map((entry) => entry.projectId))].sort()
    const boundProjectIds = projectIds.filter((projectId) => {
      const project = store.getProjects?.().find((entry) => entry.id === projectId)
      return project && Object.hasOwn(project, 'primaryAuthorityFingerprint')
    })
    if (boundProjectIds.length > 0 && !this.deps.isDesktopAuthority()) {
      if (!this.deps.forwardProjectRemovalAuthorization) {
        throw new Error('primary_authority_unavailable')
      }
      const runForwarded = async (index: number): Promise<T> => {
        const projectId = boundProjectIds[index]
        if (!projectId) {
          return operation()
        }
        return this.deps.forwardProjectRemovalAuthorization!(projectId, repoId, () =>
          runForwarded(index + 1)
        )
      }
      return runForwarded(0)
    }
    const run = async (index: number): Promise<T> => {
      const projectId = projectIds[index]
      if (!projectId) {
        return operation()
      }
      return this.getGate().withProjectLock(projectId, async () => {
        const project = store.getProjects?.().find((entry) => entry.id === projectId)
        if (project && Object.hasOwn(project, 'primaryAuthorityFingerprint')) {
          this.getGate().assertAuthorityAvailable()
        }
        await this.assertProjectRemovalAllowed(projectId, repoId, hostId)
        return run(index + 1)
      })
    }
    return run(0)
  }

  async beginProjectRemovalPermit(
    projectId: string,
    resourceKey: string,
    environmentId: string,
    requesterFingerprint: string
  ): Promise<string> {
    if (!this.deps.isDesktopAuthority()) {
      throw new Error('primary_authority_unavailable')
    }
    const setupPrefix = 'setup:'
    const repoPrefix = 'repo:'
    const hostId = `runtime:${environmentId}`
    const preflight = async (): Promise<void> => {
      if (resourceKey.startsWith(setupPrefix)) {
        await this.assertSetupRemovalAllowed(projectId, resourceKey.slice(setupPrefix.length), hostId)
        return
      }
      if (resourceKey.startsWith(repoPrefix)) {
        const repoId = resourceKey.slice(repoPrefix.length)
        const belongs = this.requireStore().getProjectHostSetups?.().some(
          (entry) => entry.projectId === projectId && entry.repoId === repoId && entry.hostId === hostId
        )
        if (!belongs) {
          throw new Error('primary_workspace_wrong_project')
        }
        await this.assertProjectRemovalAllowed(projectId, repoId, hostId)
        return
      }
      throw new Error('invalid_primary_project_mutation_resource')
    }
    return this.getGate().beginProjectMutationPermit(
      projectId,
      resourceKey,
      requesterFingerprint,
      preflight
    )
  }

  finishProjectRemovalPermit(
    token: string,
    projectId: string,
    resourceKey: string,
    requesterFingerprint: string,
    isCurrent: () => boolean
  ): Promise<boolean> {
    if (!this.deps.isDesktopAuthority()) {
      return Promise.resolve(false)
    }
    return this.getGate().finishProjectMutationPermit(
      token,
      { projectId, resourceKey, requesterFingerprint },
      isCurrent
    )
  }

  private async assertSetupRemovalAllowed(
    projectId: string,
    setupId: string,
    expectedHostId?: string
  ): Promise<void> {
    const setup = this.requireStore().getProjectHostSetups?.().find(
      (entry) => entry.id === setupId && entry.projectId === projectId
    )
    if (!setup || (expectedHostId && setup.hostId !== expectedHostId)) {
      throw new Error('primary_workspace_wrong_project')
    }
    await this.assertProjectRemovalAllowed(projectId, setup.repoId, setup.hostId)
  }

  private async assertProjectRemovalAllowed(
    projectId: string,
    repoId: string,
    hostId?: string
  ): Promise<void> {
    const project = this.requireStore().getProjects?.().find((entry) => entry.id === projectId)
    if (!project) {
      throw new Error('primary_workspace_wrong_project')
    }
    const primary = project.primaryWorkspace
    if (!primary) {
      if (Object.hasOwn(project, 'primaryAuthorityFingerprint')) {
        this.getGate().assertAuthorityAvailable()
      }
      return
    }
    const setup = this.requireStore().getProjectHostSetups?.().find(
      (entry) => entry.projectId === projectId && entry.repoId === repoId &&
        (!hostId || entry.hostId === hostId)
    )
    if (!setup || (hostId && setup.hostId !== hostId)) {
      return
    }
    const savedLocatorNamesRepo =
      typeof primary.worktreeId === 'string' && primary.worktreeId.startsWith(`${repoId}::`)
    const parsedSetupHost = parseExecutionHostId(setup.hostId)
    const expectedOwnerHostId = parsedSetupHost?.kind === 'runtime'
      ? setup.runtimeOwnerHostId
      : setup.hostId
    const expectedOwnerFingerprint = parsedSetupHost?.kind === 'runtime'
      ? setup.runtimeOwnerFingerprint
      : this.deps.getOwnPeerFingerprint()
    const savedOwnerMatches = Boolean(
      primary.hostId && expectedOwnerHostId && primary.hostId === expectedOwnerHostId &&
      primary.peerFingerprint && expectedOwnerFingerprint &&
      primary.peerFingerprint === expectedOwnerFingerprint
    )
    const savedOwnerContradicts = Boolean(
      (primary.hostId && expectedOwnerHostId && primary.hostId !== expectedOwnerHostId) ||
      (primary.peerFingerprint && expectedOwnerFingerprint &&
        primary.peerFingerprint !== expectedOwnerFingerprint)
    )
    if (savedLocatorNamesRepo && savedOwnerMatches) {
      throw new Error('primary_selected')
    }
    if (
      savedLocatorNamesRepo &&
      !savedOwnerMatches &&
      !savedOwnerContradicts
    ) {
      if (!this.deps.isDesktopAuthority()) {
        this.getGate().assertAuthorityAvailable()
      }
      throw new Error('primary_workspace_identity_unavailable')
    }
    if (!primary.peerFingerprint || !primary.hostId || !primary.worktreeId || !primary.instanceId) {
      if (!this.deps.isDesktopAuthority()) {
        this.getGate().assertAuthorityAvailable()
      }
      if (savedLocatorNamesRepo && !savedOwnerContradicts) {
        throw new Error('primary_selected')
      }
      throw new Error('primary_workspace_identity_unavailable')
    }
    const owner = await this.findPrimaryOwnerOnHost(projectId, primary, setup.hostId)
    if (!owner) {
      if (savedLocatorNamesRepo && !savedOwnerContradicts) {
        throw new Error('primary_workspace_unavailable')
      }
      return
    }
    const ownerHostId = owner.ownerHostId ?? owner.hostId
    const fingerprint = owner.peerFingerprint ??
      ((ownerHostId === 'local' || ownerHostId?.startsWith('ssh:')) ? this.deps.getOwnPeerFingerprint() : null)
    if (owner.repoId === repoId && ownerHostId === primary.hostId && fingerprint === primary.peerFingerprint) {
      throw new Error('primary_selected')
    }
  }

  private async findPrimaryOwnerOnHost(
    projectId: string,
    primary: NonNullable<Project['primaryWorkspace']>,
    setupHostId: string
  ): Promise<ResolvedWorktree | undefined> {
    const parsedHost = parseExecutionHostId(setupHostId)
    const rows = parsedHost?.kind === 'runtime'
      ? await this.requireAuthenticatedRuntimeWorktrees(projectId, parsedHost.environmentId)
      : await this.deps.listResolvedWorktrees()
    return rows.find((entry) => {
      const ownerHostId = entry.ownerHostId ?? entry.hostId
      const peerFingerprint =
        entry.peerFingerprint ??
        (ownerHostId === 'local' || ownerHostId?.startsWith('ssh:')
          ? this.deps.getOwnPeerFingerprint()
          : null)
      return (
        entry.id === primary.worktreeId &&
        entry.instanceId === primary.instanceId &&
        ownerHostId === primary.hostId &&
        peerFingerprint === primary.peerFingerprint
      )
    })
  }

  guardPrimarySetupRemoval(setupId: string, expectedHostId: string): Promise<void> {
    return this.guardSetupRemoval(setupId, async () => undefined, expectedHostId)
  }

  guardPrimaryProjectRemoval<T>(
    repoId: string,
    expectedHostId: string | undefined,
    operation: () => Promise<T> = async () => undefined as T
  ): Promise<T> {
    return this.guardProjectRemoval(repoId, expectedHostId, operation)
  }

  async beginRemoval(
    projectId: string,
    target: PrimaryWorkspaceTarget,
    ownerEnvironmentId?: string
  ): Promise<string> {
    if (!this.deps.isDesktopAuthority()) {
      if (!this.deps.forwardRemovalBegin) {throw new Error('primary_authority_unavailable')}
      return this.deps.forwardRemovalBegin(projectId, target).then((token) => {
        this.forwardedProjectByToken.set(token, projectId)
        this.forwardedTargetByToken.set(token, { ...target })
        return token
      })
    }
    const worktrees = ownerEnvironmentId
      ? await this.requireAuthenticatedRuntimeWorktrees(projectId, ownerEnvironmentId)
      : await this.deps.listResolvedWorktrees()
    const row = worktrees.find(
      (entry) =>
        entry.instanceId === target.instanceId &&
        (target.path === undefined || entry.path === target.path) &&
        (entry.peerFingerprint ??
          ((entry.ownerHostId ?? entry.hostId) === 'local' ||
          (entry.ownerHostId ?? entry.hostId)?.startsWith('ssh:')
            ? this.deps.getOwnPeerFingerprint()
            : null)) === target.peerFingerprint &&
        (entry.ownerHostId ?? entry.hostId) === target.hostId
    )
    if (!row || !(await this.verifyRemovalOwner(row, ownerEnvironmentId))) {
      throw new Error('primary_workspace_unavailable')
    }
    const store = this.requireStore()
    const setup = store
      .getProjectHostSetups?.()
      .find(
        (entry) =>
          entry.projectId === projectId &&
          entry.repoId === row.repoId &&
          (!ownerEnvironmentId || entry.hostId === `runtime:${ownerEnvironmentId}`)
      )
    if (!setup) {
      throw new Error('primary_workspace_wrong_project')
    }
    const repo = store.getRepos().find((entry) => entry.id === row.repoId)
    if (row.git.isMainWorktree || (repo && isFolderRepo(repo))) {
      throw new Error('primary_workspace_not_removable')
    }
    return this.getGate().beginRemoval(projectId, target)
  }

  async beginRemovalForWorktree(
    worktreeId: string,
    hostId?: string
  ): Promise<{ token: string; target: PrimaryWorkspaceTarget; projectId: string } | null> {
    const store = this.requireStore()
    const repoId = worktreeId.slice(0, worktreeId.indexOf('::'))
    const setup = store
      .getProjectHostSetups?.()
      .find((entry) => entry.repoId === repoId && (!hostId || entry.hostId === hostId))
    const projectId = setup?.projectId
    if (!projectId) {
      return null
    }
    const project = store.getProjects?.().find((entry) => entry.id === projectId)
    if (!project) {
      return null
    }
    if (
      !project.primaryWorkspace &&
      !Object.hasOwn(project, 'primaryAuthorityFingerprint')
    ) {
      return null
    }
    const parsedHost = parseExecutionHostId(hostId)
    const environment = parsedHost?.kind === 'runtime' ? parsedHost.environmentId : undefined
    const worktrees = environment
      ? await this.requireAuthenticatedRuntimeWorktrees(projectId, environment)
      : await this.deps.listResolvedWorktrees()
    const row = worktrees.find(
      (entry) => entry.id === worktreeId && (!hostId || entry.hostId === hostId)
    )
    if (!row) {
      throw new Error('primary_workspace_unavailable')
    }
    const peerFingerprint =
      row.peerFingerprint ??
      (row.hostId === 'local' || row.hostId?.startsWith('ssh:')
        ? this.deps.getOwnPeerFingerprint()
        : null)
    const ownerHostId = row.ownerHostId ?? row.hostId
    const parsedOwnerHostId = parseExecutionHostId(ownerHostId)
    if (
      !ownerHostId ||
      !parsedOwnerHostId ||
      parsedOwnerHostId.kind === 'runtime' ||
      !row.instanceId ||
      !peerFingerprint
    ) {
      throw new Error('primary_workspace_identity_unavailable')
    }
    const target = {
      peerFingerprint,
      hostId: ownerHostId,
      instanceId: row.instanceId,
      path: row.path
    }
    const token = await this.beginRemoval(projectId, target, environment)
    return { token, target, projectId }
  }

  finishRemoval(token: string, owner: PrimaryWorkspaceTarget): Promise<boolean> {
    if (!this.deps.isDesktopAuthority()) {
      const completedTarget = this.completedTokens.get(token)
      const finished = Boolean(completedTarget && sameTarget(completedTarget, owner))
      this.completedTokens.delete(token)
      this.forwardedProjectByToken.delete(token)
      this.forwardedTargetByToken.delete(token)
      return Promise.resolve(finished)
    }
    return this.getGate()
      .finishRemoval(token, owner)
      .then((finished) => {
        if (finished) {
          this.completedTokens.delete(token)
        }
        return finished
      })
  }

  async recordCompletion(token: string, owner: PrimaryWorkspaceTarget): Promise<void> {
    if (!this.deps.isDesktopAuthority()) {
      const projectId = this.forwardedProjectByToken.get(token)
      const expectedTarget = this.forwardedTargetByToken.get(token)
      if (!projectId || !this.deps.forwardRemovalFinish) {
        throw new Error('unknown_removal_token')
      }
      if (!expectedTarget || !sameTarget(expectedTarget, owner)) {
        throw new Error('owner_mismatch')
      }
      await this.deps.forwardRemovalFinish(projectId, token, owner)
      this.completedTokens.set(token, { ...owner })
      return
    }
    await this.getGate().assertRemovalOwner(token, owner)
    this.completedTokens.set(token, { ...owner })
  }

  private getGate(): ProjectPrimaryMutationGate {
    if (this.gate) {
      return this.gate
    }
    const store = this.requireStore()
    this.gate = new ProjectPrimaryMutationGate({
      store: {
        load: async () => {
          if (typeof store.getPrimaryRemovalReservations !== 'function') {
            throw new Error('runtime_unavailable')
          }
          return store.getPrimaryRemovalReservations()
        },
        save: async (reservation) => {
          if (!store.savePrimaryRemovalReservation) {
            throw new Error('runtime_unavailable')
          }
          await store.savePrimaryRemovalReservation(reservation)
        },
        remove: async (token) => {
          if (!store.removePrimaryRemovalReservation) {
            throw new Error('runtime_unavailable')
          }
          await store.removePrimaryRemovalReservation(token)
        }
      },
      isAuthorityAvailable: () =>
        this.deps.isDesktopAuthority() &&
        this.requireStore().isPrimaryWorkspaceMutationAvailable !== false,
      getPrimary: (projectId) => {
        const primary = store
          .getProjects?.()
          .find((entry) => entry.id === projectId)?.primaryWorkspace
        if (
          primary &&
          (!primary.peerFingerprint ||
            !primary.authorityFingerprint ||
            !primary.hostId ||
            !primary.worktreeId ||
            !primary.path ||
            !primary.instanceId)
        ) {
          throw new Error('primary_workspace_identity_unavailable')
        }
        return primary?.peerFingerprint
          ? {
              peerFingerprint: primary.peerFingerprint,
              hostId: primary.hostId,
              instanceId: primary.instanceId,
              path: primary.path
            }
          : undefined
      },
      confirmRemovalCompletion: async (reservation) => this.completedTokens.has(reservation.token)
    })
    return this.gate
  }

  private requireAuthenticatedRuntimeWorktrees(
    projectId: string,
    environmentId: string
  ): Promise<ResolvedWorktree[]> {
    if (!this.deps.listAuthenticatedRuntimeWorktrees) {
      throw new Error('primary_authority_unavailable')
    }
    return this.deps.listAuthenticatedRuntimeWorktrees(projectId, environmentId)
  }

  private async verifyRemovalOwner(
    worktree: ResolvedWorktree,
    ownerEnvironmentId?: string
  ): Promise<boolean> {
    if (ownerEnvironmentId) {
      return (
        worktree.hostId === `runtime:${ownerEnvironmentId}` &&
        worktree.runtimeOwnerEnvironmentId === ownerEnvironmentId &&
        Boolean(worktree.peerFingerprint)
      )
    }
    return this.deps.verifyAuthoritativeWorktree
      ? this.deps.verifyAuthoritativeWorktree(worktree)
      : false
  }

  private requireStore(): RuntimeStore {
    const store = this.deps.getStore()
    if (!store) {
      throw new Error('runtime_unavailable')
    }
    return store
  }
}
