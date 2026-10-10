import type {
  Project,
  ProjectHostSetup,
  ProjectHostSetupCreateArgs,
  ProjectHostSetupCreateResult,
  ProjectHostSetupDeleteArgs,
  ProjectHostSetupDeleteResult,
  ProjectHostSetupUpdateArgs,
  ProjectHostSetupUpdateResult,
  ProjectUpdateArgs
} from '../../../shared/project-types'
import type { PersistedState } from '../../../shared/persisted-state-types'
import type { Repo } from '../../../shared/repo-types'
import {
  getRepoExecutionHostId,
  normalizeExecutionHostId,
  parseExecutionHostId
} from '../../../shared/execution-host'
import { normalizePrimaryWorkspaceRevision } from '../../../shared/project-primary-workspace'
import { normalizeProjectRuntimePreference } from '../../../shared/project-execution-runtime'
import { makeProjectHostSetupId } from './project-host-compatibility'
import { repoGitUsernameCacheKey } from './repo-hydration'

export type ProjectHostMutationOperations = {
  state: PersistedState
  gitUsernameCache: Map<string, string>
  bumpLocalWorktreeScanGeneration: (repoId: string) => void
  hydrateRepo: (repo: Repo) => Repo
  updateRepoBackedProjectHostSetup: (
    setup: ProjectHostSetup,
    repo: Repo,
    updates: ProjectHostSetupUpdateArgs['updates']
  ) => { setup: ProjectHostSetup; repo: Repo } | null
  updateIndependentProjectHostSetup: (
    setup: ProjectHostSetup,
    updates: ProjectHostSetupUpdateArgs['updates']
  ) => ProjectHostSetup
  removeProjectForHost: (id: string, hostId: ProjectHostSetup['hostId']) => void
  scheduleSave: () => void
}

export class ProjectHostPersistenceOperations {
  constructor(private readonly operations: ProjectHostMutationOperations) {}

  private get state(): PersistedState {
    return this.operations.state
  }

  private get gitUsernameCache(): Map<string, string> {
    return this.operations.gitUsernameCache
  }

  private hydrateRepo(repo: Repo): Repo {
    return this.operations.hydrateRepo(repo)
  }

  private updateRepoBackedProjectHostSetup(
    setup: ProjectHostSetup,
    repo: Repo,
    updates: ProjectHostSetupUpdateArgs['updates']
  ): { setup: ProjectHostSetup; repo: Repo } | null {
    return this.operations.updateRepoBackedProjectHostSetup(setup, repo, updates)
  }

  private updateIndependentProjectHostSetup(
    setup: ProjectHostSetup,
    updates: ProjectHostSetupUpdateArgs['updates']
  ): ProjectHostSetup {
    return this.operations.updateIndependentProjectHostSetup(setup, updates)
  }

  private removeProjectForHost(id: string, hostId: ProjectHostSetup['hostId']): void {
    this.operations.removeProjectForHost(id, hostId)
  }

  private scheduleSave(): void {
    this.operations.scheduleSave()
  }

  // ── Repos ──────────────────────────────────────────────────────────

  getRepos(): Repo[] {
    return this.state.repos.map((repo) => this.hydrateRepo(repo))
  }

  getProjects(): Project[] {
    return [...this.state.projects]
  }

  registerRemoteProjectAuthorityCompatibility(input: {
    remoteProject: Project
    hostId: ProjectHostSetup['hostId']
    setups: readonly ProjectHostSetup[]
    authorityFingerprint: string
    runtimeOwnerFingerprint?: string
  }): Project {
    if (
      !input.remoteProject.id.trim() ||
      !input.remoteProject.displayName.trim() ||
      !input.authorityFingerprint.trim() ||
      parseExecutionHostId(input.hostId)?.kind !== 'runtime'
    ) {
      throw new Error('invalid_remote_project_authority_projection')
    }
    const existing = this.state.projects.find((entry) => entry.id === input.remoteProject.id)
    if (
      existing &&
      ((Object.hasOwn(existing, 'primaryAuthorityFingerprint') &&
        existing.primaryAuthorityFingerprint !== input.authorityFingerprint) ||
        (!Object.hasOwn(existing, 'primaryAuthorityFingerprint') &&
          Object.hasOwn(existing, 'primaryWorkspace')))
    ) {
      throw new Error('primary_authority_conflict')
    }
    const project = existing ?? {
      id: input.remoteProject.id,
      displayName: input.remoteProject.displayName,
      badgeColor: input.remoteProject.badgeColor,
      sourceRepoIds: [],
      createdAt: input.remoteProject.createdAt,
      updatedAt: Date.now(),
      ...(input.remoteProject.providerIdentity
        ? { providerIdentity: { ...input.remoteProject.providerIdentity } }
        : {}),
      ...(input.remoteProject.gitRemoteIdentity
        ? { gitRemoteIdentity: { ...input.remoteProject.gitRemoteIdentity } }
        : {}),
      ...(input.remoteProject.kind ? { kind: input.remoteProject.kind } : {}),
      ...(input.remoteProject.repoIcon !== undefined
        ? { repoIcon: input.remoteProject.repoIcon }
        : {})
    }
    let changed = false
    if (!existing) {
      this.state.projects.push(project)
      changed = true
    }
    if (project.primaryAuthorityFingerprint !== input.authorityFingerprint) {
      project.primaryAuthorityFingerprint = input.authorityFingerprint
      changed = true
    }
    const hostId = normalizeExecutionHostId(input.hostId)!
    for (const remoteSetup of input.setups) {
      if (remoteSetup.projectId !== project.id || !remoteSetup.id || !remoteSetup.repoId) {
        continue
      }
      const setupId = `${hostId}::${remoteSetup.id}`
      const current = this.state.projectHostSetups.find((entry) => entry.id === setupId)
      const projected: ProjectHostSetup = {
        ...remoteSetup,
        id: setupId,
        projectId: project.id,
        hostId,
        runtimeOwnerEnvironmentId: hostId.slice('runtime:'.length),
        ...(input.runtimeOwnerFingerprint
          ? { runtimeOwnerFingerprint: input.runtimeOwnerFingerprint }
          : {}),
        runtimeOwnerHostId: normalizeExecutionHostId(remoteSetup.hostId) ?? remoteSetup.hostId,
        connectionId: null,
        executionHostId: null,
        createdAt: Number.isFinite(remoteSetup.createdAt) ? remoteSetup.createdAt : Date.now(),
        updatedAt: Number.isFinite(remoteSetup.updatedAt) ? remoteSetup.updatedAt : Date.now()
      }
      if (current) {
        if (JSON.stringify(current) !== JSON.stringify(projected)) {
          Object.assign(current, projected)
          changed = true
        }
      } else {
        this.state.projectHostSetups.push(projected)
        changed = true
      }
    }
    if (changed) {
      this.scheduleSave()
    }
    return { ...project }
  }

  updateProject(id: string, updates: ProjectUpdateArgs['updates']): Project | null {
    const project = this.state.projects.find((entry) => entry.id === id)
    if (!project) {
      return null
    }
    if ('localWindowsRuntimePreference' in updates) {
      for (const repoId of project.sourceRepoIds) {
        this.operations.bumpLocalWorktreeScanGeneration(repoId)
      }
      if (updates.localWindowsRuntimePreference === undefined) {
        delete project.localWindowsRuntimePreference
      } else {
        project.localWindowsRuntimePreference = normalizeProjectRuntimePreference(
          updates.localWindowsRuntimePreference
        )
      }
    }
    project.updatedAt = Date.now()
    this.scheduleSave()
    return { ...project }
  }

  setPrimaryWorkspace(
    id: string,
    primary: Project['primaryWorkspace'] | undefined
  ): Project | null {
    const project = this.state.projects.find((entry) => entry.id === id)
    if (!project) {
      return null
    }
    const revision = normalizePrimaryWorkspaceRevision(project.primaryWorkspaceRevision)
    if (revision === null) {
      throw new Error('primary_workspace_revision_unavailable')
    }
    if (
      project.primaryAuthorityFingerprint !== undefined &&
      !isNonBlank(project.primaryAuthorityFingerprint)
    ) {
      throw new Error('primary_authority_unavailable')
    }
    if (
      primary &&
      (!isNonBlank(primary.instanceId) ||
        !isNonBlank(primary.worktreeId) ||
        !isNonBlank(primary.path) ||
        !isNonBlank(primary.peerFingerprint) ||
        !isNonBlank(primary.authorityFingerprint) ||
        !isCanonicalPrimaryHost(primary.hostId) ||
        (project.primaryAuthorityFingerprint !== undefined &&
          project.primaryAuthorityFingerprint !== primary.authorityFingerprint))
    ) {
      throw new Error('Invalid primary workspace locator')
    }
    if (
      primary &&
      (!project.primaryAuthorityFingerprint ||
        primary.authorityFingerprint !== project.primaryAuthorityFingerprint)
    ) {
      throw new Error('primary_authority_unavailable')
    }
    const current = project.primaryWorkspace
    const unchanged = Boolean(
      (!current && !primary) ||
      (current &&
        primary &&
        current.worktreeId === primary.worktreeId &&
        current.instanceId === primary.instanceId &&
        current.hostId === primary.hostId &&
        current.path === primary.path &&
        current.peerFingerprint === primary.peerFingerprint &&
        current.authorityFingerprint === primary.authorityFingerprint)
    )
    if (!unchanged) {
      if (revision >= Number.MAX_SAFE_INTEGER) {
        throw new Error('primary_workspace_revision_unavailable')
      }
      project.primaryWorkspaceRevision = revision + 1
      if (primary) {
        project.primaryWorkspace = { ...primary }
      } else {
        delete project.primaryWorkspace
      }
      project.updatedAt = Date.now()
      this.scheduleSave()
    }
    return { ...project }
  }

  getProjectHostSetups(): ProjectHostSetup[] {
    return [...this.state.projectHostSetups]
  }

  createProjectHostSetup(args: ProjectHostSetupCreateArgs): ProjectHostSetupCreateResult | null {
    const project = this.state.projects.find((entry) => entry.id === args.projectId)
    if (!project) {
      return null
    }
    const hostId = normalizeExecutionHostId(args.hostId)
    if (!hostId) {
      throw new Error(`Invalid host ID: ${args.hostId}`)
    }
    const duplicateSetup = this.state.projectHostSetups.find(
      (entry) => entry.projectId === project.id && entry.hostId === hostId
    )
    if (duplicateSetup) {
      throw new Error(`Project host setup already exists: ${duplicateSetup.id}`)
    }
    const now = Date.now()
    const existingIds = new Set(this.state.projectHostSetups.map((entry) => entry.id))
    const setup: ProjectHostSetup = {
      id: makeProjectHostSetupId(project.id, hostId, existingIds, args.setupId),
      projectId: project.id,
      hostId,
      repoId: '',
      path: args.path?.trim() ?? '',
      displayName: args.displayName?.trim() || project.displayName,
      ...(args.kind ? { kind: args.kind } : {}),
      ...(args.worktreeBasePath?.trim() ? { worktreeBasePath: args.worktreeBasePath.trim() } : {}),
      ...(args.gitUsername?.trim() ? { gitUsername: args.gitUsername.trim() } : {}),
      setupState: args.setupState ?? 'not-set-up',
      setupMethod: args.setupMethod ?? 'provisioned',
      createdAt: now,
      updatedAt: now
    }
    // Why: persist independently so future repo projection sync doesn't erase this non-repo-backed setup.
    this.state.projectHostSetups.push(setup)
    this.scheduleSave()
    return { project, setup }
  }

  updateProjectHostSetup(args: ProjectHostSetupUpdateArgs): ProjectHostSetupUpdateResult | null {
    const setup = this.state.projectHostSetups.find((entry) => entry.id === args.setupId)
    if (!setup) {
      return null
    }
    const project = this.state.projects.find((entry) => entry.id === setup.projectId)
    if (!project) {
      return null
    }
    const repo = setup.repoId
      ? this.state.repos.find((entry) => entry.id === setup.repoId)
      : undefined
    if (repo) {
      const updated = this.updateRepoBackedProjectHostSetup(setup, repo, args.updates)
      const updatedProject = updated
        ? this.state.projects.find((entry) => entry.id === updated.setup.projectId)
        : undefined
      return updated && updatedProject
        ? { project: updatedProject, setup: updated.setup, repo: updated.repo }
        : null
    }
    const updatedSetup = this.updateIndependentProjectHostSetup(setup, args.updates)
    return { project, setup: updatedSetup }
  }

  deleteProjectHostSetup(args: ProjectHostSetupDeleteArgs): ProjectHostSetupDeleteResult | null {
    const setup = this.state.projectHostSetups.find((entry) => entry.id === args.setupId)
    if (!setup) {
      return null
    }
    const project = this.state.projects.find((entry) => entry.id === setup.projectId)
    if (!project) {
      return null
    }
    // Why: the same repo id can exist on multiple execution hosts, so match this setup's own host
    // row and never fall back to a sibling host's row — a stale repoId/hostId would delete that host's
    // registration. With no exact match the setup is stale, and the path below drops just the setup.
    const repo = setup.repoId
      ? this.state.repos.find(
          (entry) => entry.id === setup.repoId && getRepoExecutionHostId(entry) === setup.hostId
        )
      : undefined
    if (repo) {
      this.removeProjectForHost(repo.id, setup.hostId)
      return { project, setup, repo: this.hydrateRepo(repo) }
    }
    this.state.projectHostSetups = this.state.projectHostSetups.filter(
      (entry) => entry.id !== setup.id
    )
    this.scheduleSave()
    return { project, setup }
  }

  /** O(1) repo count; unlike `getRepos()` this skips per-repo hydration. */
  getRepoCount(): number {
    return this.state.repos.length
  }

  getRepo(id: string): Repo | undefined {
    const repo = this.state.repos.find((r) => r.id === id)
    return repo ? this.hydrateRepo(repo) : undefined
  }

  /**
   * Record a background-resolved git username; kept out of updateRepo's whitelist so the renderer can't write it directly.
   * Takes the probed repo, not just its id: the same id can exist on several execution hosts, and an
   * id-only lookup would write one host's username onto a sibling host's row and cache key.
   * @returns true when the hydrated value changed.
   */
  setResolvedRepoGitUsername(
    target: Pick<Repo, 'id' | 'connectionId' | 'executionHostId'>,
    username: string
  ): boolean {
    const targetHostId = getRepoExecutionHostId(target)
    const repo = this.state.repos.find(
      (r) => r.id === target.id && getRepoExecutionHostId(r) === targetHostId
    )
    if (!repo) {
      return false
    }
    const cacheKey = repoGitUsernameCacheKey(repo)
    const previous = this.gitUsernameCache.get(cacheKey) ?? repo.gitUsername ?? ''
    this.gitUsernameCache.set(cacheKey, username)
    if (previous === username) {
      return false
    }
    if (username) {
      // Why: persist so the next launch hydrates repos with the right branch prefix before enrichment re-runs.
      repo.gitUsername = username
    } else {
      delete repo.gitUsername
    }
    this.scheduleSave()
    return true
  }
}

function isNonBlank(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isCanonicalPrimaryHost(value: unknown): value is string {
  if (typeof value !== 'string' || normalizeExecutionHostId(value) !== value) {
    return false
  }
  const parsed = parseExecutionHostId(value)
  return Boolean(parsed && parsed.kind !== 'runtime')
}
