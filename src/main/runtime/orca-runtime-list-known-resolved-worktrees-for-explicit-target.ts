// @ts-nocheck -- mechanically split from OrcaRuntimeService; behavior is covered by AST equivalence and characterization tests.
import { OrcaRuntimeWithResolveWorktreeSelector } from './orca-runtime-resolve-worktree-selector'
import type { ResolvedWorktree } from './runtime-worktree-path-identity'
import { splitWorktreeIdForFilesystem } from '../../shared/worktree/id'
import { isPathInsideOrEqual } from '../../shared/cross-platform-path'
import type { ResolvedWorktreeSnapshot } from './runtime-resolved-worktree-cache'
import { RESOLVED_WORKTREE_CACHE_TTL_MS } from './orca-runtime-postlude'
import { getWorktreeScanMutationRevision } from '../local-worktree-scan-generation'
import {
  resolveLocalProjectRuntimeForRepo,
  resolveLocalProjectRuntimesForRepos
} from '../project-runtime-git-options'
import { getAgentLaunchPlatformForRepo } from './runtime-agent-launch-resolution'
import { resolveRepoWorktreeRows, resolveScopedWorktreeIdRow } from './repo-worktree-row-resolution'
import { projectResolvedWorktreeLineage } from '../../shared/resolved-worktree-lineage'
import type { RepoWorktreeRowDeps } from './repo-worktree-row-resolution'
import { listRuntimeFolderWorkspaces } from './runtime-worktree-filesystem'
import type { ExecutionHostId } from '../../shared/execution-host'
import type { Repo } from '../../shared/repo-types'
import type { Worktree } from '../../shared/worktree/types'
import type { ProjectExecutionRuntimeResolution } from '../../shared/project-execution-runtime'
import type { RuntimeWorktreeScanResult } from './repo-worktree-resolution-scan'
import { getSshGitProviderGeneration } from '../providers/ssh-git-dispatch'
import {
  getRepoExecutionHostId,
  getRepoSshConnectionId,
  parseExecutionHostId
} from '../../shared/execution-host'
import type { RuntimeWorktreeScanCache } from './orca-runtime-core'
import { resolveWorktreeScanCacheTtlMs } from './runtime-worktree-scan-cache'
import { isFolderRepo } from '../../shared/repo-kind'
import { decideProjectPrimaryWorkspaceLifecycle } from './project-primary-workspace-lifecycle'
import type { PrimaryLifecycleWorktree } from './project-primary-workspace-lifecycle'
import type { PrimaryWorkspaceTarget } from '../../shared/project-primary-removal'
import { inspectFolderRootPresence } from './project-primary-owner-verification'
import { notifyProjectPrimaryAuthorityChanged } from './project-primary-authority-notifier'
import { fenceObservedMissingPrimaryWorktree } from './project-primary-workspace-disappearance'
import {
  hasSavedPrimaryWorkspace,
  resolveProjectPrimaryWorkspace
} from '../../shared/project-primary-workspace'
import type { Store } from '../persistence'

type PrimaryLifecycleScanMetadata = {
  authoritativeRepoIds: ReadonlySet<string>
  ownPeerFingerprint: string | null
  allowLegacySeed: boolean
  missingFolderRepoIds: ReadonlySet<string>
}

const primaryLifecycleMetadataByWorktrees = new WeakMap<
  PrimaryLifecycleWorktree[],
  PrimaryLifecycleScanMetadata
>()
const scheduledPrimaryLifecycleWorktrees = new WeakSet<PrimaryLifecycleWorktree[]>()

export class OrcaRuntimeWithListKnownResolvedWorktreesForExplicitTarget extends OrcaRuntimeWithResolveWorktreeSelector {
  protected listKnownResolvedWorktreesForExplicitTarget(
    targetWorktreeId: string,
    targetWorktree: ResolvedWorktree | null
  ): ResolvedWorktree[] {
    if (!this.store || !targetWorktree) {
      return []
    }
    const target = splitWorktreeIdForFilesystem(targetWorktreeId)
    if (!target?.repoId || !target.worktreePath) {
      // Folder workspace keys have no repo/path tuple, but the converted row
      // is already authoritative for this explicit target.
      return [targetWorktree]
    }
    const worktreeIds = new Set(
      Object.keys(this.store.getAllWorktreeMeta()).filter((worktreeId) => {
        const parsed = splitWorktreeIdForFilesystem(worktreeId)
        return (
          parsed?.repoId === target.repoId &&
          Boolean(parsed.worktreePath) &&
          (isPathInsideOrEqual(target.worktreePath, parsed.worktreePath) ||
            isPathInsideOrEqual(parsed.worktreePath, target.worktreePath))
        )
      })
    )
    worktreeIds.add(targetWorktreeId)

    const resolved: ResolvedWorktree[] = []
    for (const worktreeId of worktreeIds) {
      const worktree =
        worktreeId === targetWorktreeId
          ? targetWorktree
          : this.buildResolvedWorktreeFromId(worktreeId)
      if (worktree) {
        resolved.push(worktree)
      }
    }
    return resolved
  }

  /** A warm fleet snapshot already answers any selector for free, so scoped scanning must yield to it. */
  protected hasFreshResolvedWorktreeCache(): boolean {
    return this.resolvedWorktrees.isFresh(getWorktreeScanMutationRevision())
  }

  protected async listResolvedWorktrees(): Promise<ResolvedWorktree[]> {
    return (await this.listResolvedWorktreeSnapshot()).worktrees
  }

  protected async listResolvedWorktreeSnapshot(): Promise<ResolvedWorktreeSnapshot> {
    if (!this.store) {
      return { worktrees: [], platformByRepoId: new Map() }
    }
    const snapshot = await this.resolvedWorktrees.getSnapshot(
      () => this.computeResolvedWorktrees(),
      RESOLVED_WORKTREE_CACHE_TTL_MS,
      getWorktreeScanMutationRevision()
    )
    const metadata = primaryLifecycleMetadataByWorktrees.get(snapshot.worktrees)
    if (metadata) {
      await this.fenceMissingPrimaryWorkspaces(snapshot.worktrees, metadata)
      this.schedulePrimaryWorkspaceLifecycle(snapshot.worktrees, metadata)
    }
    return snapshot
  }

  /** Schedule primary seed/locator refresh after native IPC published an authoritative scan. */
  async schedulePrimaryWorkspaceLifecycleFromAuthoritativeCatalog(
    worktrees: readonly Worktree[],
    authoritativeRepoIds: readonly string[],
    allowLegacySeed = false
  ): Promise<void> {
    const ownPeerFingerprint = this.getOwnPeerFingerprintFn()
    if (!ownPeerFingerprint) {
      return
    }
    const verifiedRepoIds = new Set(authoritativeRepoIds)
    const repos = this.store?.getRepos() ?? []
    for (const repo of repos) {
      if (!verifiedRepoIds.has(repo.id)) {
        continue
      }
      if (!isFolderRepo(repo)) {
        fenceObservedMissingPrimaryWorktree(
          this.requireStore() as unknown as Store,
          repo,
          worktrees.filter((worktree) => worktree.repoId === repo.id),
          ownPeerFingerprint
        )
        continue
      }
      const presence = await inspectFolderRootPresence(
        repo,
        this.requireStore() as unknown as Store
      )
      if (presence === 'missing') {
        fenceObservedMissingPrimaryWorktree(
          this.requireStore() as unknown as Store,
          repo,
          [],
          ownPeerFingerprint
        )
        verifiedRepoIds.delete(repo.id)
      } else if (presence !== 'present') {
        verifiedRepoIds.delete(repo.id)
      }
    }
    if (!this.isDesktopPrimaryAuthorityFn()) {
      return
    }
    const nativeCatalog = worktrees.filter((worktree) => {
      const hostId = worktree.ownerHostId ?? worktree.hostId
      const parsedOwner = hostId ? parseExecutionHostId(hostId) : null
      const parsedProjection = worktree.hostId ? parseExecutionHostId(worktree.hostId) : null
      return Boolean(
        worktree.peerFingerprint === ownPeerFingerprint &&
        parsedOwner &&
        (parsedOwner.kind === 'local' || parsedOwner.kind === 'ssh') &&
        parsedProjection?.id === parsedOwner.id
      )
    })
    this.schedulePrimaryWorkspaceLifecycle(nativeCatalog, {
      authoritativeRepoIds: verifiedRepoIds,
      ownPeerFingerprint,
      allowLegacySeed
    })
  }

  private schedulePrimaryWorkspaceLifecycle(
    worktrees: PrimaryLifecycleWorktree[],
    metadata: PrimaryLifecycleScanMetadata
  ): void {
    if (scheduledPrimaryLifecycleWorktrees.has(worktrees)) {
      return
    }
    scheduledPrimaryLifecycleWorktrees.add(worktrees)
    void this.reconcilePrimaryWorkspaceCatalog(
      worktrees,
      metadata.authoritativeRepoIds,
      metadata.ownPeerFingerprint,
      metadata.allowLegacySeed
    )
      .catch(() => undefined)
      .finally(() => scheduledPrimaryLifecycleWorktrees.delete(worktrees))
  }

  protected async computeResolvedWorktrees(): Promise<ResolvedWorktreeSnapshot> {
    if (!this.store) {
      return { worktrees: [], platformByRepoId: new Map() }
    }
    const metaById = this.store.getAllWorktreeMeta() ?? {}
    const repos = this.store.getRepos()
    const projectRuntimeByRepoId = resolveLocalProjectRuntimesForRepos(this.requireStore(), repos)
    const platformByRepoId = new Map(
      repos.map((repo) => [
        repo.id,
        getAgentLaunchPlatformForRepo(repo, projectRuntimeByRepoId.get(repo.id))
      ])
    )
    const authoritativeRepoIds = new Set<string>()
    const missingFolderRepoIds = new Set<string>()
    const deps = this.repoWorktreeRowDeps()
    const scanRepo = deps.scanRepo
    deps.scanRepo = async (repo, projectRuntimeByRepoId) => {
      const scan = await scanRepo(repo, projectRuntimeByRepoId)
      if (scan.ok) {
        authoritativeRepoIds.add(repo.id)
      }
      return scan
    }
    const perRepoWorktrees = await Promise.all(
      repos.map(async (repo) => {
        return await resolveRepoWorktreeRows(deps, repo, metaById, projectRuntimeByRepoId)
      })
    )
    for (const repo of repos) {
      if (!isFolderRepo(repo)) {
        continue
      }
      const presence = await inspectFolderRootPresence(
        repo,
        this.requireStore() as unknown as Store
      )
      if (presence === 'present') {
        authoritativeRepoIds.add(repo.id)
      } else if (presence === 'missing') {
        missingFolderRepoIds.add(repo.id)
      }
    }
    const lineageById = this.store?.getAllWorktreeLineage?.() ?? {}
    const worktrees = perRepoWorktrees.flatMap((rows) =>
      projectResolvedWorktreeLineage(rows, lineageById)
    )
    const ownPeerFingerprint = this.getOwnPeerFingerprintFn()
    if (ownPeerFingerprint) {
      for (const worktree of worktrees) {
        if (!authoritativeRepoIds.has(worktree.repoId)) {
          continue
        }
        const hostId = worktree.ownerHostId ?? worktree.hostId
        const parsedRowHost = worktree.hostId ? parseExecutionHostId(worktree.hostId) : null
        const parsedOwnerHost = worktree.ownerHostId
          ? parseExecutionHostId(worktree.ownerHostId)
          : null
        const parsedHost = hostId ? parseExecutionHostId(hostId) : null
        if (
          parsedRowHost?.kind === 'runtime' ||
          parsedHost?.kind === 'runtime' ||
          (parsedRowHost && parsedOwnerHost && parsedRowHost.id !== parsedOwnerHost.id)
        ) {
          continue
        }
        if (parsedHost && (parsedHost.kind === 'local' || parsedHost.kind === 'ssh')) {
          if (worktree.peerFingerprint && worktree.peerFingerprint !== ownPeerFingerprint) {
            continue
          }
          worktree.peerFingerprint = ownPeerFingerprint
          worktree.ownerHostId = parsedHost.id
        }
      }
    }
    primaryLifecycleMetadataByWorktrees.set(worktrees, {
      authoritativeRepoIds,
      ownPeerFingerprint,
      allowLegacySeed: true,
      missingFolderRepoIds
    })
    return { worktrees, platformByRepoId }
  }

  private async fenceMissingPrimaryWorkspaces(
    worktrees: readonly PrimaryLifecycleWorktree[],
    metadata: PrimaryLifecycleScanMetadata
  ): Promise<void> {
    const store = this.store
    const ownPeerFingerprint = metadata.ownPeerFingerprint
    if (!store || !ownPeerFingerprint) {
      return
    }
    const repos = store.getRepos()
    for (const repoId of metadata.authoritativeRepoIds) {
      const repo = repos.find((entry) => entry.id === repoId)
      if (!repo || isFolderRepo(repo)) {
        continue
      }
      fenceObservedMissingPrimaryWorktree(
        store as unknown as Store,
        repo,
        worktrees.filter((worktree) => worktree.repoId === repo.id),
        ownPeerFingerprint
      )
    }
    for (const repoId of metadata.missingFolderRepoIds) {
      const repo = repos.find((entry) => entry.id === repoId)
      if (!repo) {
        continue
      }
      const presence = await inspectFolderRootPresence(repo, store as unknown as Store)
      if (presence === 'missing') {
        fenceObservedMissingPrimaryWorktree(store as unknown as Store, repo, [], ownPeerFingerprint)
      }
    }
  }

  private async reconcilePrimaryWorkspaceCatalog(
    worktrees: readonly PrimaryLifecycleWorktree[],
    authoritativeRepoIds: ReadonlySet<string>,
    ownPeerFingerprint: string | null,
    allowLegacySeed: boolean
  ): Promise<void> {
    const store = this.store
    if (
      !store ||
      !ownPeerFingerprint ||
      !this.isDesktopPrimaryAuthorityFn() ||
      !store.setPrimaryWorkspaceDurably ||
      store.isPrimaryWorkspaceMutationAvailable === false
    ) {
      return
    }
    const setups = store.getProjectHostSetups?.() ?? []
    for (const project of store.getProjects?.() ?? []) {
      if (!allowLegacySeed && !project.primaryWorkspace) {
        continue
      }
      const decision = decideProjectPrimaryWorkspaceLifecycle(project, setups, worktrees, {
        ownPeerFingerprint,
        authorityFingerprint: ownPeerFingerprint,
        authoritativeRepoIds,
        isDesktopAuthority: true
      })
      if (decision.kind === 'write') {
        const target: PrimaryWorkspaceTarget = {
          peerFingerprint: decision.primary.peerFingerprint,
          hostId: decision.primary.hostId,
          instanceId: decision.primary.instanceId,
          path: decision.primary.path
        }
        try {
          await this.runPrimaryWorkspaceMutation(project.id, target, async () => {
            let currentProject = (store.getProjects?.() ?? []).find(
              (entry) => entry.id === project.id
            )
            if (!currentProject) {
              return
            }
            const binding = currentProject.primaryAuthorityFingerprint
            if (binding === undefined) {
              const savedPrimary = currentProject.primaryWorkspace
              if (
                hasSavedPrimaryWorkspace(currentProject) &&
                (!savedPrimary ||
                  savedPrimary.authorityFingerprint !== ownPeerFingerprint ||
                  !resolveProjectPrimaryWorkspace(currentProject, worktrees))
              ) {
                return
              }
              const bind = store.bindPrimaryAuthorityFingerprintDurably
              if (!bind) {
                return
              }
              const boundProject = await bind.call(store, project.id, ownPeerFingerprint)
              if (!boundProject) {
                return
              }
              currentProject = boundProject
            } else if (
              typeof binding !== 'string' ||
              binding.trim().length === 0 ||
              binding !== ownPeerFingerprint
            ) {
              return
            }
            const currentDecision = decideProjectPrimaryWorkspaceLifecycle(
              currentProject,
              store.getProjectHostSetups?.() ?? setups,
              worktrees,
              {
                ownPeerFingerprint,
                authorityFingerprint: ownPeerFingerprint,
                authoritativeRepoIds,
                isDesktopAuthority: true
              }
            )
            if (currentDecision.kind !== 'write') {
              return
            }
            const currentTarget: PrimaryWorkspaceTarget = {
              peerFingerprint: currentDecision.primary.peerFingerprint,
              hostId: currentDecision.primary.hostId,
              instanceId: currentDecision.primary.instanceId,
              path: currentDecision.primary.path
            }
            // Why: a selection changed while this scan waited; retry on the next catalog pass under its own removal fence.
            if (
              currentTarget.peerFingerprint !== target.peerFingerprint ||
              currentTarget.hostId !== target.hostId ||
              currentTarget.instanceId !== target.instanceId
            ) {
              return
            }
            const updated = await store.setPrimaryWorkspaceDurably!(
              project.id,
              currentDecision.primary
            )
            if (updated) {
              this.notifyReposChanged()
              notifyProjectPrimaryAuthorityChanged(updated)
            }
          })
        } catch {
          // A failed save remains eligible for a later authoritative catalog pass.
        }
      }
    }
  }

  /** Bind the runtime-owned scan cache and folder-workspace stamping into the row resolver. */
  protected repoWorktreeRowDeps(): RepoWorktreeRowDeps {
    const store = this.requireStore()
    return {
      store,
      scanRepo: (repo, projectRuntimeByRepoId) =>
        this.listRepoWorktreesForResolution(repo, projectRuntimeByRepoId),
      listFolderWorkspaces: (repo, repoOwnerCount) =>
        listRuntimeFolderWorkspaces(store, repo, repoOwnerCount)
    }
  }

  protected async resolveExplicitWorktreeIdScoped(
    worktreeId: string,
    requiredHostId?: ExecutionHostId
  ): Promise<ResolvedWorktree | null> {
    if (!this.store) {
      return null
    }
    return await resolveScopedWorktreeIdRow(this.repoWorktreeRowDeps(), worktreeId, requiredHostId)
  }

  protected async listRepoWorktreesForResolution(
    repo: Repo,
    projectRuntimeByRepoId?: ReadonlyMap<string, ProjectExecutionRuntimeResolution>
  ): Promise<RuntimeWorktreeScanResult> {
    // Resolve the execution host, not the raw field: an `executionHostId: 'ssh:*'` row with no
    // `connectionId` would otherwise get a local project runtime and a `local:default` cache key,
    // so its scan neither routes remotely nor re-runs when the SSH provider is replaced.
    const sshConnectionId = getRepoSshConnectionId(repo)
    const projectRuntime = projectRuntimeByRepoId
      ? projectRuntimeByRepoId.get(repo.id)
      : !sshConnectionId
        ? resolveLocalProjectRuntimeForRepo(this.requireStore(), repo)
        : undefined
    const runtimeKey = projectRuntime
      ? projectRuntime.status === 'resolved'
        ? projectRuntime.runtime.cacheKey
        : projectRuntime.repair.cacheKey
      : sshConnectionId
        ? `ssh:${sshConnectionId}:${getSshGitProviderGeneration(sshConnectionId)}`
        : 'local:default'
    const now = Date.now()
    const scanScopeKey = `${repo.id}\0${getRepoExecutionHostId(repo)}`
    const generation = this.worktreeScanGenerations.get(scanScopeKey) ?? 0
    const cached = this.worktreeScanCache.get(scanScopeKey)
    if (
      cached?.generation === generation &&
      cached.runtimeKey === runtimeKey &&
      cached.expiresAt > now
    ) {
      return cached.result
    }
    const inFlight = this.worktreeScanInFlight.get(scanScopeKey)
    if (inFlight?.generation === generation && inFlight.runtimeKey === runtimeKey) {
      const refresh = await inFlight.promise
      if (generation !== (this.worktreeScanGenerations.get(scanScopeKey) ?? 0)) {
        return this.listRepoWorktreesForResolution(repo, projectRuntimeByRepoId)
      }
      return refresh.result
    }
    const reusableCached =
      cached?.generation === generation && cached.runtimeKey === runtimeKey ? cached : null
    const promise = this.refreshRepoWorktreeScan(repo, projectRuntime, reusableCached)
    this.worktreeScanInFlight.set(scanScopeKey, { generation, runtimeKey, promise })
    try {
      const refresh = await promise
      if (generation !== (this.worktreeScanGenerations.get(scanScopeKey) ?? 0)) {
        return this.listRepoWorktreesForResolution(repo, projectRuntimeByRepoId)
      }
      if (
        (refresh.result.ok || !sshConnectionId) &&
        this.worktreeScanInFlight.get(scanScopeKey)?.promise === promise
      ) {
        const entry: RuntimeWorktreeScanCache = {
          generation,
          runtimeKey,
          result: refresh.result,
          expiresAt: Date.now() + resolveWorktreeScanCacheTtlMs(repo),
          adminFingerprint: refresh.adminFingerprint,
          scannedAt: refresh.scannedAt
        }
        this.worktreeScanCache.set(scanScopeKey, entry)
        void refresh.adminFingerprintProbe?.then((fingerprint) => {
          if (this.worktreeScanCache.get(scanScopeKey) === entry) {
            entry.adminFingerprint = fingerprint
          }
        })
      }
      return refresh.result
    } finally {
      if (this.worktreeScanInFlight.get(scanScopeKey)?.promise === promise) {
        this.worktreeScanInFlight.delete(scanScopeKey)
      }
    }
  }
}
