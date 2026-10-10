import type { Project, ProjectHostSetup, ProjectPrimaryWorkspace } from '../../shared/project-types'
import { isCanonicalNativeExecutionHostId } from '../../shared/execution-host'
import type { ExecutionHostId } from '../../shared/execution-host'
import {
  normalizePrimaryWorkspaceRevision,
  hasSavedPrimaryWorkspace,
  resolveProjectPrimaryWorkspace
} from '../../shared/project-primary-workspace'
import type { Worktree } from '../../shared/worktree/types'

export type PrimaryLifecycleWorktree = Worktree & {
  prunable?: boolean
  git?: { isBare?: boolean; prunable?: boolean; isMainWorktree?: boolean }
}

export type PrimaryWorkspaceLifecycleDecision =
  | { kind: 'unchanged' }
  | { kind: 'write'; primary: ProjectPrimaryWorkspace }

type LifecycleOptions = {
  ownPeerFingerprint: string | null
  authorityFingerprint: string | null
  authoritativeRepoIds: ReadonlySet<string>
  isDesktopAuthority: boolean
}

function getOwnerHostId(worktree: PrimaryLifecycleWorktree): ExecutionHostId | undefined {
  const hostId = worktree.ownerHostId ?? worktree.hostId
  return isCanonicalNativeExecutionHostId(hostId) ? hostId : undefined
}

function isEligible(worktree: PrimaryLifecycleWorktree): boolean {
  return Boolean(
    worktree.instanceId &&
    worktree.path &&
    worktree.id &&
    getOwnerHostId(worktree) &&
    !worktree.isArchived &&
    !worktree.isBare &&
    !worktree.prunable &&
    !worktree.git?.isBare &&
    !worktree.git?.prunable
  )
}

function primaryFromWorktree(
  worktree: PrimaryLifecycleWorktree,
  peerFingerprint: string,
  authorityFingerprint: string
): ProjectPrimaryWorkspace | undefined {
  const hostId = getOwnerHostId(worktree)
  if (!hostId || !worktree.instanceId || !worktree.path || !worktree.id) {
    return undefined
  }
  return {
    worktreeId: worktree.id,
    instanceId: worktree.instanceId,
    hostId,
    path: worktree.path,
    peerFingerprint,
    authorityFingerprint
  }
}

function samePrimaryLocator(
  current: ProjectPrimaryWorkspace,
  next: ProjectPrimaryWorkspace
): boolean {
  return current.worktreeId === next.worktreeId && current.path === next.path
}

/** Decide a one-time deterministic seed or a locator refresh for the same authenticated occupant. */
export function decideProjectPrimaryWorkspaceLifecycle(
  project: Project,
  setups: readonly ProjectHostSetup[],
  catalog: readonly PrimaryLifecycleWorktree[],
  options: LifecycleOptions
): PrimaryWorkspaceLifecycleDecision {
  if (!options.isDesktopAuthority || !options.ownPeerFingerprint || !options.authorityFingerprint) {
    return { kind: 'unchanged' }
  }
  if (normalizePrimaryWorkspaceRevision(project.primaryWorkspaceRevision) === null) {
    return { kind: 'unchanged' }
  }
  const authorityBinding = project.primaryAuthorityFingerprint
  if (
    (authorityBinding !== undefined &&
      (typeof authorityBinding !== 'string' || authorityBinding.trim().length === 0)) ||
    (typeof authorityBinding === 'string' && authorityBinding !== options.authorityFingerprint)
  ) {
    return { kind: 'unchanged' }
  }

  if (hasSavedPrimaryWorkspace(project)) {
    if (!project.primaryWorkspace) {
      return { kind: 'unchanged' }
    }
    const current = project.primaryWorkspace
    const resolved = resolveProjectPrimaryWorkspace(project, catalog)
    if (!resolved || !options.authoritativeRepoIds.has(resolved.repoId) || !isEligible(resolved)) {
      return { kind: 'unchanged' }
    }
    const next = primaryFromWorktree(
      resolved,
      current.peerFingerprint ?? '',
      current.authorityFingerprint ?? ''
    )
    return next && !samePrimaryLocator(current, next)
      ? { kind: 'write', primary: next }
      : { kind: 'unchanged' }
  }

  const readySetups = setups
    .filter((setup) => setup.projectId === project.id && setup.setupState === 'ready')
    .sort(
      (a, b) =>
        (a.createdAt ?? Number.MAX_SAFE_INTEGER) - (b.createdAt ?? Number.MAX_SAFE_INTEGER) ||
        a.id.localeCompare(b.id)
    )
  const candidates = catalog.flatMap((worktree) => {
    const ownerHostId = getOwnerHostId(worktree)
    if (
      !ownerHostId ||
      !worktree.repoId ||
      !options.authoritativeRepoIds.has(worktree.repoId) ||
      worktree.peerFingerprint !== options.ownPeerFingerprint ||
      !(worktree.isMainWorktree || worktree.git?.isMainWorktree) ||
      !isEligible(worktree)
    ) {
      return []
    }
    const setup = readySetups.find(
      (candidate) => candidate.repoId === worktree.repoId && candidate.hostId === ownerHostId
    )
    if (!setup) {
      return []
    }
    return [{ worktree, setup, ownerHostId }]
  })
  candidates.sort((a, b) => {
    return (
      Number(b.ownerHostId === 'local') - Number(a.ownerHostId === 'local') ||
      (a.setup.createdAt ?? Number.MAX_SAFE_INTEGER) -
        (b.setup.createdAt ?? Number.MAX_SAFE_INTEGER) ||
      a.setup.id.localeCompare(b.setup.id) ||
      a.worktree.id.localeCompare(b.worktree.id)
    )
  })
  const selected = candidates[0]?.worktree
  const primary = selected
    ? primaryFromWorktree(selected, options.ownPeerFingerprint, options.authorityFingerprint)
    : undefined
  return primary ? { kind: 'write', primary } : { kind: 'unchanged' }
}
