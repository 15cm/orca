import type { Repo } from '../../shared/repo-types'
import type { ResolvedWorktree } from './runtime-worktree-path-identity'
import { getRepoExecutionHostId, parseExecutionHostId } from '../../shared/execution-host'
import { isFolderRepo } from '../../shared/repo-kind'
import { listRepoWorktreesForDetectedScan } from '../repo-worktrees'
import { getLocalProjectWorktreeGitOptions } from '../project-runtime-git-options'
import { runtimePathsEqual } from './runtime-worktree-path-identity'
import type { Store } from '../persistence'
import { resolveFilesystemRouteForHost } from '../providers/execution-host-provider-dispatch'
import { getLocalWorktreePathAccess } from '../local-worktree-filesystem'
import { isENOENT } from '../ipc/filesystem-auth'

export type PrimaryOwnerVerificationDeps = {
  listRepos: () => Repo[]
  store: Store
  statOwnerPath?: (worktree: ResolvedWorktree, repo: Repo) => Promise<boolean>
}

export type FolderRootPresence = 'present' | 'missing' | 'unverifiable'

export async function inspectFolderRootPresence(
  repo: Repo,
  store: Store
): Promise<FolderRootPresence> {
  if (!isFolderRepo(repo)) {
    return 'unverifiable'
  }
  try {
    const route = resolveFilesystemRouteForHost(getRepoExecutionHostId(repo))
    if (route.kind === 'runtime' || (route.kind === 'ssh' && !route.provider)) {
      return 'unverifiable'
    }
    const result: unknown =
      route.kind === 'local'
        ? await getLocalWorktreePathAccess(getLocalProjectWorktreeGitOptions(store, repo)).statPath(
            repo.path
          )
        : route.provider
          ? await route.provider.stat(repo.path)
          : null
    if (!result || typeof result !== 'object') {
      return 'unverifiable'
    }
    const statResult = result as { isDirectory?: unknown; type?: unknown }
    return typeof statResult.isDirectory === 'function'
      ? statResult.isDirectory()
        ? 'present'
        : 'missing'
      : statResult.type === 'directory'
        ? 'present'
        : 'missing'
  } catch (error) {
    return isENOENT(error) ? 'missing' : 'unverifiable'
  }
}

export async function verifyPrimaryOwner(
  worktree: ResolvedWorktree,
  deps: PrimaryOwnerVerificationDeps
): Promise<boolean> {
  if (!worktree.instanceId || worktree.isArchived || worktree.isBare || worktree.prunable) {
    return false
  }
  const hostId = worktree.hostId
  if (!hostId) {
    return false
  }
  const repo = deps
    .listRepos()
    .find(
      (candidate) =>
        candidate.id === worktree.repoId && getRepoExecutionHostId(candidate) === hostId
    )
  if (!repo) {
    return false
  }
  const parsedHost = parseExecutionHostId(hostId)
  if (parsedHost?.kind === 'runtime') {
    const runtimeOwnerId = worktree.runtimeOwnerEnvironmentId ?? parsedHost.environmentId
    return Boolean(
      runtimeOwnerId === parsedHost.environmentId &&
      getRepoExecutionHostId(repo) === hostId &&
      worktree.ownerHostId &&
      worktree.ownerHostId !== hostId &&
      worktree.peerFingerprint &&
      worktree.peerFingerprint.trim() &&
      worktree.instanceId
    )
  }
  const currentMeta = deps.store.getWorktreeMetaForHost(worktree.id, hostId)
  if (!currentMeta?.instanceId || currentMeta.instanceId !== worktree.instanceId) {
    return false
  }
  if (isFolderRepo(repo)) {
    if (!runtimePathsEqual(repo.path, worktree.path)) {
      return false
    }
    const route = resolveFilesystemRouteForHost(getRepoExecutionHostId(repo))
    if (route.kind === 'runtime' || (route.kind === 'ssh' && !route.provider)) {
      return false
    }
    if (deps.statOwnerPath) {
      try {
        return await deps.statOwnerPath(worktree, repo)
      } catch {
        return false
      }
    }
    return (await inspectFolderRootPresence(repo, deps.store)) === 'present'
  }
  try {
    const rows = await listRepoWorktreesForDetectedScan(
      repo,
      getLocalProjectWorktreeGitOptions(deps.store, repo)
    )
    return rows.some(
      (row) => runtimePathsEqual(row.path, worktree.path) && !row.isBare && !row.prunable
    )
  } catch {
    return false
  }
}
