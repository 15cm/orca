import { randomUUID } from 'node:crypto'
import { getRepoExecutionHostId } from '../../shared/execution-host'
import type { Repo } from '../../shared/repo-types'
import { splitWorktreeIdForFilesystem } from '../../shared/worktree/id'
import type { GitWorktreeInfo } from '../../shared/worktree/types'
import type { Store } from '../persistence/loading-store/store'
import {
  readWorktreeMetaForRepo,
  writeWorktreeMetaForHost
} from '../persistence/host-qualified-worktree-meta'
import { runtimePathsEqual } from './runtime-worktree-path-identity'

/** Rotate retained primary metadata only after an authenticated successful scan proves its path gone. */
export function fenceObservedMissingPrimaryWorktree(
  store: Store,
  repo: Repo,
  liveWorktrees: readonly (Pick<GitWorktreeInfo, 'path' | 'isBare' | 'prunable'> & {
    git?: Pick<GitWorktreeInfo, 'isBare' | 'prunable'>
  })[],
  ownPeerFingerprint: string | null
): void {
  if (!ownPeerFingerprint) {
    return
  }
  const hostId = getRepoExecutionHostId(repo)
  const presentWorktrees = liveWorktrees.filter(
    (worktree) =>
      !worktree.isBare &&
      !worktree.prunable &&
      !worktree.git?.isBare &&
      !worktree.git?.prunable
  )
  for (const project of store.getProjects()) {
    const primary = project.primaryWorkspace
    if (
      !primary ||
      typeof primary.instanceId !== 'string' ||
      !primary.instanceId.trim() ||
      typeof primary.path !== 'string' ||
      !primary.path.trim() ||
      typeof primary.worktreeId !== 'string' ||
      !primary.worktreeId.trim() ||
      typeof primary.peerFingerprint !== 'string' ||
      !primary.peerFingerprint.trim() ||
      typeof primary.authorityFingerprint !== 'string' ||
      !primary.authorityFingerprint.trim() ||
      project.primaryAuthorityFingerprint !== primary.authorityFingerprint ||
      primary.hostId !== hostId ||
      primary.peerFingerprint !== ownPeerFingerprint
    ) {
      continue
    }
    const parsed = splitWorktreeIdForFilesystem(primary.worktreeId)
    if (
      !parsed ||
      parsed.repoId !== repo.id ||
      !runtimePathsEqual(parsed.worktreePath, primary.path)
    ) {
      continue
    }
    if (presentWorktrees.some(({ path }) => runtimePathsEqual(path, primary.path))) {
      continue
    }
    const metadata = readWorktreeMetaForRepo(store, primary.worktreeId, repo)
    if (!metadata?.instanceId || metadata.instanceId !== primary.instanceId) {
      continue
    }
    const occupantMoved = presentWorktrees.some(({ path }) => {
      const liveId = `${repo.id}::${path}`
      return readWorktreeMetaForRepo(store, liveId, repo)?.instanceId === primary.instanceId
    })
    if (occupantMoved) {
      continue
    }
    writeWorktreeMetaForHost(store, primary.worktreeId, hostId, { instanceId: randomUUID() })
  }
}
