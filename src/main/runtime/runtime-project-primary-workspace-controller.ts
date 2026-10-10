import type { Project, ProjectHostSetup, ProjectPrimarySelector } from '../../shared/project-types'
import { parseExecutionHostId } from '../../shared/execution-host'
import type { PrimaryWorkspaceTarget } from '../../shared/project-primary-removal'
import type { RuntimeStore } from './runtime-store-contract'
import type { ResolvedWorktree } from './runtime-worktree-path-identity'
import { matchWorktreeSelectorCandidates } from './runtime-worktree-selector-candidates'
import { notifyProjectPrimaryAuthorityChanged } from './project-primary-authority-notifier'

type Dependencies = {
  getStore: () => RuntimeStore | null
  listProjects: () => Project[]
  listSetups: () => ProjectHostSetup[]
  listResolvedWorktrees: () => Promise<ResolvedWorktree[]>
  listAuthenticatedRuntimeWorktrees?: (
    projectId: string,
    environmentId: string
  ) => Promise<ResolvedWorktree[]>
  verifyAuthoritativeWorktree: (worktree: ResolvedWorktree) => Promise<boolean>
  getOwnPeerFingerprint: () => string | null
  isDesktopAuthority?: () => boolean
  forwardPrimaryWorkspace?: (args: ProjectPrimarySelector) => Promise<Project>
  runPrimaryMutation: <T>(
    projectId: string,
    target: PrimaryWorkspaceTarget,
    operation: () => Promise<T>
  ) => Promise<T>
  flushPrimaryPersistence: () => Promise<void>
  invalidateResolvedWorktrees: () => void
  notifyReposChanged: () => void
}

export class RuntimeProjectPrimaryWorkspaceController {
  constructor(private readonly deps: Dependencies) {}

  async set(args: ProjectPrimarySelector): Promise<Project> {
    return this.setWithAuthenticatedPeer(args)
  }

  async setWithAuthenticatedPeer(
    args: ProjectPrimarySelector,
    requesterEnvironmentId?: string
  ): Promise<Project> {
    if (this.deps.isDesktopAuthority?.() === false) {
      if (!this.deps.forwardPrimaryWorkspace) {
        throw new Error('primary_authority_unavailable')
      }
      return this.deps.forwardPrimaryWorkspace(args)
    }
    const store = this.deps.getStore()
    const project = this.deps.listProjects().find((entry) => entry.id === args.projectId)
    if (!project || !store?.setPrimaryWorkspaceDurably) {
      throw new Error(`Project not found: ${args.projectId}`)
    }
    const listWorktrees = async (): Promise<ResolvedWorktree[]> => {
      const local = await this.deps.listResolvedWorktrees()
      if (requesterEnvironmentId) {
        if (!this.deps.listAuthenticatedRuntimeWorktrees) {
          throw new Error('primary_authority_unavailable')
        }
        return this.deps.listAuthenticatedRuntimeWorktrees(project.id, requesterEnvironmentId)
      }
      const parsedHost = parseExecutionHostId(args.hostId)
      if (parsedHost?.kind !== 'runtime') {
        return local
      }
      if (!this.deps.listAuthenticatedRuntimeWorktrees) {
        throw new Error('primary_authority_unavailable')
      }
      return [
        ...local,
        ...(await this.deps.listAuthenticatedRuntimeWorktrees(project.id, parsedHost.environmentId))
      ]
    }
    const authenticatedPeerHostId = requesterEnvironmentId
      ? `runtime:${requesterEnvironmentId}`
      : undefined
    const requestedOwnerHostId =
      requesterEnvironmentId && (!args.hostId || args.hostId === 'local')
        ? 'local'
        : args.hostId
    const candidates = matchWorktreeSelectorCandidates(args.worktree, await listWorktrees()).filter(
      (entry) => {
        if (requesterEnvironmentId) {
          return (
            entry.hostId === authenticatedPeerHostId &&
            (entry.ownerHostId ?? entry.hostId) === requestedOwnerHostId
          )
        }
        return !args.hostId || entry.hostId === args.hostId || entry.ownerHostId === args.hostId
      }
    )
    if (candidates.length !== 1) {
      throw new Error(
        candidates.length ? 'primary_workspace_ambiguous' : 'primary_workspace_not_found'
      )
    }
    const worktree = candidates[0]
    const ownerHostId = worktree.ownerHostId ?? worktree.hostId
    if (!ownerHostId) {
      throw new Error('primary_workspace_identity_unavailable')
    }
    const authorityFingerprint = this.deps.getOwnPeerFingerprint()
    const peerFingerprint =
      worktree.peerFingerprint ??
      (!worktree.runtimeOwnerEnvironmentId &&
      (ownerHostId === 'local' || ownerHostId.startsWith('ssh:'))
        ? authorityFingerprint
        : null)
    if (!authorityFingerprint || !peerFingerprint) {
      throw new Error('primary_workspace_identity_unavailable')
    }
    if (
      worktree.isArchived ||
      worktree.git?.isBare ||
      worktree.git?.prunable ||
      !worktree.instanceId
    ) {
      throw new Error('primary_workspace_ineligible')
    }
    const setup = this.deps.listSetups().find((entry) => {
      if (entry.projectId !== project.id || entry.setupState !== 'ready') {
        return false
      }
      if (
        args.hostId &&
        entry.hostId !== args.hostId &&
        entry.hostId !== ownerHostId &&
        entry.hostId !== authenticatedPeerHostId
      ) {
        return false
      }
      if (
        entry.hostId !== worktree.hostId &&
        entry.hostId !== ownerHostId &&
        entry.hostId !== `runtime:${worktree.runtimeOwnerEnvironmentId}`
      ) {
        return false
      }
      return worktree.projectId === project.id || entry.repoId === worktree.repoId
    })
    if (
      !setup ||
      (args.hostId &&
        worktree.hostId !== args.hostId &&
        ownerHostId !== args.hostId &&
        worktree.hostId !== authenticatedPeerHostId)
    ) {
      throw new Error('primary_workspace_wrong_project')
    }
    const primary = {
      worktreeId: worktree.id,
      instanceId: worktree.instanceId,
      hostId: ownerHostId,
      path: worktree.path,
      peerFingerprint,
      authorityFingerprint
    }
    const target = {
      peerFingerprint,
      hostId: primary.hostId,
      instanceId: primary.instanceId,
      path: primary.path
    }
    const persist = async () => {
      const currentSetup = this.deps
        .listSetups()
        .some(
          (entry) =>
            entry.id === setup.id &&
            entry.projectId === project.id &&
            entry.repoId === worktree.repoId &&
            entry.setupState === 'ready'
        )
      const currentWorktree = (await listWorktrees()).find(
        (entry) =>
          entry.id === worktree.id &&
            entry.hostId === worktree.hostId &&
          (entry.ownerHostId ?? entry.hostId) === primary.hostId &&
          entry.instanceId === primary.instanceId &&
            entry.repoId === worktree.repoId &&
            entry.peerFingerprint === worktree.peerFingerprint
      )
      if (
        !currentSetup ||
        !currentWorktree ||
        !(await this.deps.verifyAuthoritativeWorktree(currentWorktree))
      ) {
        throw new Error('primary_workspace_unavailable')
      }
      if (!store.bindPrimaryAuthorityFingerprintDurably) {
        throw new Error('primary_authority_unavailable')
      }
      await store.bindPrimaryAuthorityFingerprintDurably(project.id, authorityFingerprint)
      return store.setPrimaryWorkspaceDurably!(project.id, primary)
    }
    const result = await this.deps.runPrimaryMutation(project.id, target, persist)
    if (!result) {
      throw new Error(`Project not found: ${args.projectId}`)
    }
    this.deps.invalidateResolvedWorktrees()
    this.deps.notifyReposChanged()
    notifyProjectPrimaryAuthorityChanged(result)
    return result
  }
}
