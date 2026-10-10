import type {
  Project,
  ProjectHostSetup,
  ProjectHostSetupCloneArgs,
  ProjectHostSetupCreateArgs,
  ProjectHostSetupCreateResult,
  ProjectHostSetupDeleteArgs,
  ProjectHostSetupDeleteResult,
  ProjectHostSetupExistingFolderArgs,
  ProjectHostSetupResult,
  ProjectHostSetupUpdateArgs,
  ProjectHostSetupUpdateResult,
  ProjectPrimarySelector,
  ProjectUpdateArgs
} from '../../shared/project-types'
import type { Repo } from '../../shared/repo-types'
import {
  getSshTargetIdForExecutionHost,
  parseExecutionHostId,
  type ExecutionHostId
} from '../../shared/execution-host'
import { getProjectIdForProviderIdentity } from '../../shared/project-host-setup-projection'
import { getProjectHostSetupForRepo } from '../../shared/project-host-setup-lookup'
import { invalidateAuthorizedRootsCache } from '../ipc/filesystem-auth'
import { prepareLocalWorktreeRootForRepo } from '../worktree-root-preparation'
import type { RuntimeStore } from './runtime-store-contract'
import type { PrimaryWorkspaceTarget } from '../../shared/project-primary-removal'
import type { ResolvedWorktree } from './runtime-worktree-path-identity'
import { RuntimeProjectPrimaryWorkspaceController } from './runtime-project-primary-workspace-controller'

type RuntimeProjectHostSetupDependencies = {
  getStore: () => RuntimeStore | null
  listRepos: () => Repo[]
  addRepo: (path: string, kind: 'folder' | 'git', hostId: ExecutionHostId) => Promise<Repo>
  /** Register an existing path that lives on an SSH host; `addRepo` only reaches local/runtime hosts. */
  addRemoteRepo: (args: {
    connectionId: string
    remotePath: string
    displayName?: string
    kind: 'folder' | 'git'
  }) => Promise<Repo>
  cloneRepo: (url: string, destination: string, hostId: ExecutionHostId) => Promise<Repo>
  invalidateResolvedWorktrees: () => void
  invalidateWorktreeScan: (repoId: string) => void
  notifyReposChanged: () => void
  listResolvedWorktrees?: () => Promise<ResolvedWorktree[]>
  verifyAuthoritativeWorktree?: (worktree: ResolvedWorktree) => Promise<boolean>
  listAuthenticatedRuntimeWorktrees?: (
    projectId: string,
    environmentId: string
  ) => Promise<ResolvedWorktree[]>
  getOwnPeerFingerprint?: () => string | null
  isDesktopAuthority?: () => boolean
  forwardPrimaryWorkspace?: (args: ProjectPrimarySelector) => Promise<Project>
  runPrimaryMutation?: <T>(
    projectId: string,
    target: PrimaryWorkspaceTarget,
    operation: () => Promise<T>
  ) => Promise<T>
  flushPrimaryPersistence?: () => Promise<void>
  guardSetupRemoval?: <T>(setupId: string, operation: () => Promise<T>) => Promise<T>
}

// Why clone alone still refuses: nothing in this process clones onto an SSH host. `cloneRepo` runs
// `git clone` on the client, so accepting `ssh:*` here would register the client's copy as the
// host's repo — a local answer to a remote question. Registering an existing remote path, by
// contrast, has a correct implementation this process already uses over IPC.
function assertCloneHostIsSupported(hostId: ExecutionHostId | null | undefined): void {
  if (parseExecutionHostId(hostId)?.kind !== 'ssh') {
    return
  }
  throw new Error(
    'Cloning onto an SSH host is not supported. Clone the repository on the host, then set the project up from that existing folder.'
  )
}

export class RuntimeProjectHostSetupController {
  private readonly primaryWorkspace: RuntimeProjectPrimaryWorkspaceController

  constructor(private readonly deps: RuntimeProjectHostSetupDependencies) {
    this.primaryWorkspace = new RuntimeProjectPrimaryWorkspaceController({
      getStore: () => this.deps.getStore(),
      listProjects: () => this.listProjects(),
      listSetups: () => this.listSetups(),
      listResolvedWorktrees: async () => {
        if (!this.deps.listResolvedWorktrees) {
          throw new Error('runtime_unavailable')
        }
        return this.deps.listResolvedWorktrees()
      },
      listAuthenticatedRuntimeWorktrees: this.deps.listAuthenticatedRuntimeWorktrees,
      verifyAuthoritativeWorktree: async (worktree) => {
        if (!this.deps.verifyAuthoritativeWorktree) {
          throw new Error('runtime_unavailable')
        }
        return this.deps.verifyAuthoritativeWorktree(worktree)
      },
      getOwnPeerFingerprint: () => this.deps.getOwnPeerFingerprint?.() ?? null,
      isDesktopAuthority: () => this.deps.isDesktopAuthority?.() ?? true,
      forwardPrimaryWorkspace: this.deps.forwardPrimaryWorkspace,
      runPrimaryMutation: async (projectId, target, operation) => {
        if (!this.deps.runPrimaryMutation) {
          throw new Error('runtime_unavailable')
        }
        return this.deps.runPrimaryMutation(projectId, target, operation)
      },
      flushPrimaryPersistence: async () => {
        if (!this.deps.flushPrimaryPersistence) {
          throw new Error('runtime_unavailable')
        }
        await this.deps.flushPrimaryPersistence()
      },
      invalidateResolvedWorktrees: () => this.deps.invalidateResolvedWorktrees(),
      notifyReposChanged: () => this.deps.notifyReposChanged()
    })
  }

  listProjects(): Project[] {
    return this.deps.getStore()?.getProjects?.() ?? []
  }

  updateProject(projectId: string, updates: ProjectUpdateArgs['updates']): Project {
    const store = this.deps.getStore()
    if (!store?.updateProject) {
      throw new Error('runtime_unavailable')
    }
    const project = store.updateProject(projectId, updates)
    if (!project) {
      throw new Error(`Project not found: ${projectId}`)
    }
    this.deps.invalidateResolvedWorktrees()
    this.deps.notifyReposChanged()
    return project
  }

  setPrimaryWorkspace(args: ProjectPrimarySelector): Promise<Project> {
    return this.primaryWorkspace.set(args)
  }

  setPrimaryWorkspaceForPeer(
    args: ProjectPrimarySelector,
    environmentId: string
  ): Promise<Project> {
    return this.primaryWorkspace.setWithAuthenticatedPeer(args, environmentId)
  }

  async bindPrimaryAuthorityFingerprint(projectId: string, fingerprint: string): Promise<Project> {
    const store = this.deps.getStore()
    if (!store?.bindPrimaryAuthorityFingerprintDurably) {
      throw new Error('runtime_unavailable')
    }
    const project = await store.bindPrimaryAuthorityFingerprintDurably(projectId, fingerprint)
    if (!project) {
      throw new Error(`Project not found: ${projectId}`)
    }
    this.deps.notifyReposChanged()
    return project
  }

  async applyPrimaryAuthoritySnapshot(input: {
    projectId: string
    fingerprint: string
    primaryWorkspace: Project['primaryWorkspace'] | null | undefined
    revision: number
  }): Promise<Project> {
    const store = this.deps.getStore()
    if (!store?.applyPrimaryAuthoritySnapshotDurably) {
      throw new Error('runtime_unavailable')
    }
    const project = await store.applyPrimaryAuthoritySnapshotDurably(input)
    if (!project) {
      throw new Error(`Project not found: ${input.projectId}`)
    }
    this.deps.notifyReposChanged()
    return project
  }

  runPrimaryWorkspaceMutation<T>(
    projectId: string,
    target: PrimaryWorkspaceTarget,
    operation: () => Promise<T>
  ): Promise<T> {
    if (!this.deps.runPrimaryMutation) {
      throw new Error('runtime_unavailable')
    }
    return this.deps.runPrimaryMutation(projectId, target, operation)
  }

  listSetups(): ProjectHostSetup[] {
    return this.deps.getStore()?.getProjectHostSetups?.() ?? []
  }

  createSetup(args: ProjectHostSetupCreateArgs): ProjectHostSetupCreateResult {
    const store = this.deps.getStore()
    if (!store?.createProjectHostSetup) {
      throw new Error('runtime_unavailable')
    }
    const result = store.createProjectHostSetup(args)
    if (!result) {
      throw new Error(`Project not found: ${args.projectId}`)
    }
    return result
  }

  async setupExistingFolder(
    args: ProjectHostSetupExistingFolderArgs
  ): Promise<ProjectHostSetupResult> {
    if (!this.deps.getStore()) {
      throw new Error('runtime_unavailable')
    }
    const kind = args.kind === 'folder' ? 'folder' : 'git'
    const knownRepoIds = new Set(this.deps.listRepos().map((repo) => repo.id))
    // Why route rather than refuse: this process owns the SSH connection, and its own IPC handler
    // already registers `ssh:*` hosts correctly. Refusing here only made the CLI and runtime RPC
    // disagree with the desktop app about what the same process can do.
    const sshTargetId = getSshTargetIdForExecutionHost(args.hostId)
    const repo = sshTargetId
      ? await this.deps.addRemoteRepo({
          connectionId: sshTargetId,
          remotePath: args.path,
          ...(args.displayName ? { displayName: args.displayName } : {}),
          kind
        })
      : await this.deps.addRepo(args.path, kind, args.hostId)
    return this.completeSetup(args, repo, !knownRepoIds.has(repo.id))
  }

  async setupClone(args: ProjectHostSetupCloneArgs): Promise<ProjectHostSetupResult> {
    assertCloneHostIsSupported(args.hostId)
    const knownRepoIds = new Set(this.deps.listRepos().map((repo) => repo.id))
    const repo = await this.deps.cloneRepo(args.url, args.destination, args.hostId)
    return this.completeSetup(
      { ...args, path: repo.path, kind: 'git', setupMethod: 'cloned' },
      repo,
      !knownRepoIds.has(repo.id)
    )
  }

  updateSetup(args: ProjectHostSetupUpdateArgs): ProjectHostSetupUpdateResult {
    const store = this.deps.getStore()
    if (!store?.updateProjectHostSetup) {
      throw new Error('runtime_unavailable')
    }
    const result = store.updateProjectHostSetup(args)
    if (!result) {
      throw new Error(`Project host setup not found: ${args.setupId}`)
    }
    if ('worktreeBasePath' in args.updates && result.repo) {
      void prepareLocalWorktreeRootForRepo(store, result.repo)
      invalidateAuthorizedRootsCache()
    }
    return result
  }

  deleteSetup(args: ProjectHostSetupDeleteArgs): Promise<ProjectHostSetupDeleteResult> {
    const store = this.deps.getStore()
    if (!store?.deleteProjectHostSetup) {
      throw new Error('runtime_unavailable')
    }
    if (!this.deps.flushPrimaryPersistence || !this.deps.guardSetupRemoval) {
      throw new Error('runtime_unavailable')
    }
    const remove = async () => {
      const result = store.deleteProjectHostSetup!(args)
      if (!result) {
        throw new Error(`Project host setup not found: ${args.setupId}`)
      }
      await this.deps.flushPrimaryPersistence!()
      return result
    }
    const guarded = this.deps.guardSetupRemoval(args.setupId, remove)
    return guarded.then((result) => {
      this.deps.notifyReposChanged()
      return result
    })
  }

  private completeSetup(
    args: ProjectHostSetupExistingFolderArgs,
    initialRepo: Repo,
    repoWasCreated: boolean
  ): ProjectHostSetupResult {
    try {
      return this.linkRepo(args, initialRepo)
    } catch (error) {
      if (repoWasCreated) {
        this.deps.getStore()?.removeProject?.(initialRepo.id)
        this.deps.invalidateResolvedWorktrees()
        this.deps.invalidateWorktreeScan(initialRepo.id)
        invalidateAuthorizedRootsCache()
        this.deps.notifyReposChanged()
      }
      throw error
    }
  }

  private linkRepo(
    args: ProjectHostSetupExistingFolderArgs,
    initialRepo: Repo
  ): ProjectHostSetupResult {
    const store = this.deps.getStore()
    if (!store) {
      throw new Error('runtime_unavailable')
    }
    let repo = initialRepo
    let setup = getProjectHostSetupForRepo(this.listSetups(), repo)
    if (setup.projectId !== args.projectId) {
      const existingProject = this.listProjects().find((project) => project.id === args.projectId)
      const identity = existingProject?.providerIdentity ?? args.projectProviderIdentity
      if (!identity || getProjectIdForProviderIdentity(identity) !== args.projectId) {
        throw new Error('Imported folder does not match the selected project identity.')
      }
      const updated = store.updateRepo(repo.id, {
        upstream: {
          owner: identity.owner,
          repo: identity.repo,
          ...(identity.host ? { host: identity.host } : {})
        }
      })
      if (!updated) {
        throw new Error(`Project setup repo disappeared before it could be linked: ${repo.id}`)
      }
      repo = updated
      setup = getProjectHostSetupForRepo(this.listSetups(), repo)
    }
    const setupMethod = args.setupMethod ?? 'imported-existing-folder'
    const updated = store.updateRepo(repo.id, { projectHostSetupMethod: setupMethod })
    if (!updated) {
      throw new Error(
        `Project setup repo disappeared before setup metadata could be linked: ${repo.id}`
      )
    }
    repo = updated
    setup = getProjectHostSetupForRepo(this.listSetups(), repo)
    const project = this.listProjects().find((entry) => entry.id === setup.projectId)
    if (!project) {
      throw new Error(`Project setup was created without a project record: ${setup.projectId}`)
    }
    return { project, setup, repo }
  }
}
