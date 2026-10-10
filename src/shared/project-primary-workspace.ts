import type { Project, ProjectPrimaryWorkspace } from './project-types'
import { isCanonicalNativeExecutionHostId } from './execution-host'

export type PrimaryWorkspaceCatalogEntry = {
  id: string
  path: string
  displayName?: string
  instanceId?: string
  hostId?: string
  peerFingerprint?: string
  runtimeOwnerEnvironmentId?: string
  ownerHostId?: string
  isArchived?: boolean
  isBare?: boolean
  prunable?: boolean
}

export function hasSavedPrimaryWorkspace(project: Pick<Project, 'primaryWorkspace'>): boolean {
  return project.primaryWorkspace !== undefined
}

export function normalizePrimaryWorkspaceRevision(value: unknown): number | null {
  if (value === undefined) {
    return 0
  }
  return Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : null
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/** Resolve the selected occupant; locator fields only help route current rows. */
export function resolveProjectPrimaryWorkspace<T extends PrimaryWorkspaceCatalogEntry>(
  project: Project,
  catalog: readonly T[]
): T | undefined {
  const primary: ProjectPrimaryWorkspace | undefined = project.primaryWorkspace
  const projectAuthority = project.primaryAuthorityFingerprint
  if (
    normalizePrimaryWorkspaceRevision(project.primaryWorkspaceRevision) === null ||
    (projectAuthority !== undefined && !hasText(projectAuthority)) ||
    !primary ||
    !hasText(primary.instanceId) ||
    !hasText(primary.peerFingerprint) ||
    !hasText(primary.authorityFingerprint) ||
    (projectAuthority !== undefined && primary.authorityFingerprint !== projectAuthority) ||
    !hasText(primary.hostId) ||
    !isCanonicalNativeExecutionHostId(primary.hostId) ||
    !hasText(primary.worktreeId) ||
    !hasText(primary.path)
  ) {
    return undefined
  }
  const ownerMatches = (entry: PrimaryWorkspaceCatalogEntry) => {
    const catalogOwner = entry.ownerHostId ?? entry.hostId
    return (
      catalogOwner === primary.hostId && isCanonicalNativeExecutionHostId(catalogOwner)
    )
  }
  const matches = catalog.filter(
    (entry) =>
      hasText(entry.instanceId) &&
      entry.instanceId === primary.instanceId &&
      ownerMatches(entry) &&
      !entry.isArchived &&
      !entry.isBare &&
      !entry.prunable &&
      entry.peerFingerprint === primary.peerFingerprint
  )
  return matches.length === 1 ? matches[0] : undefined
}

