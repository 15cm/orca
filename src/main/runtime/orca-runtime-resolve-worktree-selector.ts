// @ts-nocheck -- mechanically split from OrcaRuntimeService; behavior is covered by AST equivalence and characterization tests.
import { OrcaRuntimeWithResolveBrowserNetworkExecutionHostForWorktree } from './orca-runtime-resolve-browser-network-execution-host-for-worktree'
import type { ResolvedWorktree } from './runtime-worktree-path-identity'
import { splitWorktreeIdForFilesystem } from '../../shared/worktree/id'
import { runtimePathsEqual } from './runtime-worktree-path-identity'
import { matchWorktreeSelectorCandidates } from './runtime-worktree-selector-candidates'
import { getRepoExecutionHostId, getWorktreeExecutionHostId } from '../../shared/execution-host'
import type {
  WorktreeLineageInput,
  WorktreeLineageResolution
} from './runtime-worktree-lineage-resolution'
import type { OrchestrationDb } from './orchestration/db'
import { resolveNestedWorkerMaxDepth } from '../../shared/nested-worker-depth'
import type { WorkspaceLineage, WorktreeLineage } from '../../shared/worktree/lineage-types'
import type { WorkspaceKey } from '../../shared/folder-workspace-types'
import type { Repo } from '../../shared/repo-types'
import type { Store } from '../persistence'
import { areWorktreePathsEqual, mergeWorktree } from '../ipc/worktree-logic'

export class OrcaRuntimeWithResolveWorktreeSelector extends OrcaRuntimeWithResolveBrowserNetworkExecutionHostForWorktree {
  protected async resolveWorktreeSelector(selector: string): Promise<ResolvedWorktree> {
    const explicitWorktreeId = this.getValidatedExplicitWorktreeIdSelector(selector)
    // Why only `id:`: every other selector kind is matched across the whole fleet, and their
    // `selector_ambiguous` contract is defined over all repos. Scoping those would silently pick a
    // winner where today they correctly refuse. An `id:` selector already names its repo.
    if (explicitWorktreeId && !this.hasFreshResolvedWorktreeCache()) {
      const scoped = await this.resolveExplicitWorktreeIdScoped(explicitWorktreeId)
      if (scoped) {
        return scoped
      }
    }
    const worktrees = await this.listResolvedWorktrees()
    const candidates = matchWorktreeSelectorCandidates(selector, worktrees, {
      getHostId: (worktree) =>
        getWorktreeExecutionHostId(worktree, this.store?.getRepo(worktree.repoId))
    })

    if (candidates.length === 0 && selector.startsWith('id:')) {
      const worktreeId = explicitWorktreeId ?? selector.slice(3)
      if (candidates.length === 0) {
        const parsed = splitWorktreeIdForFilesystem(worktreeId)
        const repo = parsed ? this.store?.getRepo(parsed.repoId) : null
        const fallback =
          repo?.connectionId && this.store?.getWorktreeMeta(worktreeId)
            ? this.buildResolvedWorktreeFromId(worktreeId)
            : null
        if (fallback !== null) {
          candidates.push(fallback)
        }
      }
    }
    if (candidates.length === 1) {
      return candidates[0]
    }
    if (candidates.length > 1) {
      throw new Error('selector_ambiguous')
    }
    throw new Error('selector_not_found')
  }

  protected resolveLineageForWorktreeCreate(
    input?: WorktreeLineageInput
  ): Promise<WorktreeLineageResolution> {
    return this.worktreeLineage.resolveCreate(input)
  }

  protected getOrchestrationDbIfAvailable(): OrchestrationDb | null {
    return this._orchestrationDb
  }

  getNestedWorkerMaxDepth(): number {
    return resolveNestedWorkerMaxDepth({
      nestedWorkerMaxDepth: (
        this.store?.getSettings?.() as { nestedWorkerMaxDepth?: number } | undefined
      )?.nestedWorkerMaxDepth
    })
  }

  hydrateInferredWorktreeLineage(): Promise<void> {
    return this.worktreeLineage.hydrate()
  }

  listWorktreeLineage(): Promise<Record<string, WorktreeLineage>> {
    return this.worktreeLineage.listWorktreeLineage()
  }

  listWorkspaceLineage(): Promise<Record<WorkspaceKey, WorkspaceLineage>> {
    return this.worktreeLineage.listWorkspaceLineage()
  }

  // Why: one selector grammar, so connection-scoped resolution can narrow the same
  // candidate set instead of reimplementing (and diverging from) the matching rules.
  protected selectReposBySelector(selector: string): Repo[] {
    const repos = this.store?.getRepos() ?? []
    if (selector.startsWith('id:')) {
      return repos.filter((repo) => repo.id === selector.slice(3))
    }
    if (selector.startsWith('path:')) {
      return repos.filter((repo) => runtimePathsEqual(repo.path, selector.slice(5)))
    }
    if (selector.startsWith('name:')) {
      return repos.filter((repo) => repo.displayName === selector.slice(5))
    }
    return repos.filter(
      (repo) =>
        repo.id === selector ||
        runtimePathsEqual(repo.path, selector) ||
        repo.displayName === selector
    )
  }

  protected async resolveRepoSelector(selector: string): Promise<Repo> {
    if (!this.store) {
      throw new Error('repo_not_found')
    }
    const candidates = this.selectReposBySelector(selector)

    if (candidates.length === 1) {
      return candidates[0]
    }
    if (candidates.length > 1) {
      throw new Error('selector_ambiguous')
    }
    throw new Error('repo_not_found')
  }

  protected requireStore(): Store {
    if (!this.store) {
      throw new Error('runtime_unavailable')
    }
    return this.store as unknown as Store
  }

  protected buildResolvedWorktreeFromId(worktreeId: string): ResolvedWorktree | null {
    const parsed = splitWorktreeIdForFilesystem(worktreeId)
    if (!parsed?.repoId || !parsed.worktreePath) {
      return null
    }
    const repo = this.store?.getRepos?.()?.find((entry) => entry.id === parsed.repoId)
    const git = {
      path: parsed.worktreePath,
      head: '',
      branch: '',
      isBare: false,
      isMainWorktree: repo ? areWorktreePathsEqual(parsed.worktreePath, repo.path) : false
    }
    const meta = this.store?.getWorktreeMeta(worktreeId)
    const merged = {
      ...mergeWorktree(parsed.repoId, git, meta, repo?.displayName),
      ...(repo ? { hostId: meta?.hostId ?? getRepoExecutionHostId(repo) } : {})
    }
    return {
      ...merged,
      id: worktreeId,
      parentWorktreeId: null,
      childWorktreeIds: [],
      lineage: null,
      git,
      displayName: merged.displayName,
      comment: merged.comment
    }
  }
}
