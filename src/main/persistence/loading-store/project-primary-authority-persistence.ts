import type { Project } from '../../../shared/project-types'
import { normalizePrimaryWorkspaceRevision } from '../../../shared/project-primary-workspace'
import {
  isCanonicalNativeExecutionHostId,
  normalizeExecutionHostId,
  parseExecutionHostId,
  toSshExecutionHostId
} from '../../../shared/execution-host'

type Dependencies = {
  projects: () => Project[]
  isWritable: () => boolean
  flush: () => Promise<void>
  scheduleSave: () => void
  freezeWrites: () => void
  setPrimaryWorkspace: (id: string, primary: Project['primaryWorkspace']) => Project | null
}

function samePrimaryWorkspace(
  left: Project['primaryWorkspace'] | null | undefined,
  right: Project['primaryWorkspace'] | null | undefined
): boolean {
  if (!left || !right) {
    return left === right
  }
  return (
    left.worktreeId === right.worktreeId &&
    left.instanceId === right.instanceId &&
    left.hostId === right.hostId &&
    left.path === right.path &&
    left.peerFingerprint === right.peerFingerprint &&
    left.authorityFingerprint === right.authorityFingerprint
  )
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function hasCanonicalText(value: unknown): value is string {
  return hasText(value) && value === value.trim()
}

function capturePrimary(project: Project) {
  return {
    primaryWorkspace: project.primaryWorkspace,
    primaryPresent: Object.hasOwn(project, 'primaryWorkspace'),
    revision: project.primaryWorkspaceRevision,
    revisionPresent: Object.hasOwn(project, 'primaryWorkspaceRevision'),
    updatedAt: project.updatedAt
  }
}

function restorePrimary(project: Project, prior: ReturnType<typeof capturePrimary>): void {
  if (prior.primaryPresent) {
    project.primaryWorkspace = prior.primaryWorkspace
  } else {
    delete project.primaryWorkspace
  }
  if (prior.revisionPresent) {
    project.primaryWorkspaceRevision = prior.revision
  } else {
    delete project.primaryWorkspaceRevision
  }
  project.updatedAt = prior.updatedAt
}

function isValidAuthoritySnapshotChoice(
  primary: unknown,
  authorityFingerprint: string
): primary is NonNullable<Project['primaryWorkspace']> {
  if (!primary || typeof primary !== 'object') {
    return false
  }
  const candidate = primary as Record<string, unknown>
  const hostId = candidate.hostId
  const normalizedHostId = typeof hostId === 'string' ? normalizeExecutionHostId(hostId) : null
  const parsedHost = typeof hostId === 'string' ? parseExecutionHostId(hostId) : null
  const canonicalHostId =
    parsedHost?.kind === 'local'
      ? parsedHost.id
      : parsedHost?.kind === 'ssh'
        ? toSshExecutionHostId(parsedHost.targetId)
        : null
  return Boolean(
    hasText(candidate.worktreeId) &&
    hasText(candidate.path) &&
    hasText(candidate.instanceId) &&
    hasText(candidate.peerFingerprint) &&
    candidate.authorityFingerprint === authorityFingerprint &&
    normalizedHostId === hostId &&
    canonicalHostId === hostId &&
    typeof hostId === 'string' &&
    isCanonicalNativeExecutionHostId(hostId) &&
    (parsedHost?.kind === 'local' || parsedHost?.kind === 'ssh')
  )
}

export class ProjectPrimaryAuthorityPersistence {
  private failedClosed = false
  private readonly writesByProjectId = new Map<string, Promise<unknown>>()

  constructor(private readonly deps: Dependencies) {}

  get isAvailable(): boolean {
    return !this.failedClosed && this.deps.isWritable()
  }

  bind(projectId: string, fingerprint: string): Promise<Project | null> {
    return this.withProjectLock(projectId, async () => {
      if (!hasCanonicalText(fingerprint)) {
        throw new Error('invalid_primary_authority_fingerprint')
      }
      if (!this.isAvailable) {
        throw new Error('primary_workspace_persistence_unavailable')
      }
      const project = this.find(projectId)
      if (!project) {
        return null
      }
      const bindingPresent = Object.hasOwn(project, 'primaryAuthorityFingerprint')
      if (bindingPresent && !hasCanonicalText(project.primaryAuthorityFingerprint)) {
        throw new Error('malformed_primary_authority_binding')
      }
      if (bindingPresent && project.primaryAuthorityFingerprint !== fingerprint) {
        throw new Error('primary_authority_conflict')
      }
      const savedPrimary = project.primaryWorkspace as unknown
      if (bindingPresent) {
        const savedAuthority =
          savedPrimary && typeof savedPrimary === 'object'
            ? (savedPrimary as { authorityFingerprint?: unknown }).authorityFingerprint
            : undefined
        if (hasText(savedAuthority) && savedAuthority !== fingerprint) {
          throw new Error('primary_authority_conflict')
        }
        return { ...project }
      }
      if (
        savedPrimary !== undefined &&
        (!savedPrimary ||
          typeof savedPrimary !== 'object' ||
          !hasCanonicalText(
            (savedPrimary as { authorityFingerprint?: unknown }).authorityFingerprint
          ) ||
          (savedPrimary as { authorityFingerprint: string }).authorityFingerprint !== fingerprint)
      ) {
        throw new Error('primary_authority_conflict')
      }
      const priorUpdatedAt = project.updatedAt
      project.primaryAuthorityFingerprint = fingerprint
      project.updatedAt = Date.now()
      this.deps.scheduleSave()
      try {
        await this.deps.flush()
        return { ...project }
      } catch (error) {
        delete project.primaryAuthorityFingerprint
        project.updatedAt = priorUpdatedAt
        return this.rollback(error, 'primary_authority_persistence_failed_closed')
      }
    })
  }

  applySnapshot(input: {
    projectId: string
    fingerprint: string
    primaryWorkspace: Project['primaryWorkspace'] | null | undefined
    revision: number
  }): Promise<Project | null> {
    return this.withProjectLock(input.projectId, async () => {
      const project = this.find(input.projectId)
      if (!project) {
        return null
      }
      if (!hasCanonicalText(input.fingerprint)) {
        throw new Error('invalid_primary_authority_fingerprint')
      }
      if (
        !Object.hasOwn(project, 'primaryAuthorityFingerprint') ||
        !hasCanonicalText(project.primaryAuthorityFingerprint) ||
        project.primaryAuthorityFingerprint !== input.fingerprint
      ) {
        throw new Error('primary_authority_conflict')
      }
      const currentRevision = normalizePrimaryWorkspaceRevision(project.primaryWorkspaceRevision)
      const incomingRevision = normalizePrimaryWorkspaceRevision(input.revision)
      if (currentRevision === null || incomingRevision === null) {
        throw new Error('malformed_primary_authority_revision')
      }
      if (incomingRevision < currentRevision) {
        throw new Error('stale_primary_authority_snapshot')
      }
      if (
        incomingRevision === currentRevision &&
        !samePrimaryWorkspace(project.primaryWorkspace, input.primaryWorkspace)
      ) {
        throw new Error('conflicting_primary_authority_snapshot')
      }
      if (
        input.primaryWorkspace !== undefined &&
        input.primaryWorkspace !== null &&
        !isValidAuthoritySnapshotChoice(input.primaryWorkspace, input.fingerprint)
      ) {
        throw new Error('invalid_primary_authority_snapshot')
      }
      if (!this.isAvailable) {
        throw new Error('primary_workspace_persistence_unavailable')
      }
      const prior = capturePrimary(project)
      this.assignSnapshot(project, input.primaryWorkspace, incomingRevision)
      try {
        await this.flushSave()
        return { ...project }
      } catch (error) {
        restorePrimary(project, prior)
        return this.rollback(error, 'primary_authority_snapshot_persistence_failed_closed')
      }
    })
  }

  set(
    projectId: string,
    primary: Project['primaryWorkspace'] | undefined
  ): Promise<Project | null> {
    return this.withProjectLock(projectId, async () => {
      if (!this.isAvailable) {
        throw new Error('primary_workspace_persistence_unavailable')
      }
      const project = this.find(projectId)
      if (!project) {
        return null
      }
      const prior = capturePrimary(project)
      const result = this.deps.setPrimaryWorkspace(projectId, primary)
      try {
        await this.deps.flush()
        return result
      } catch (error) {
        restorePrimary(project, prior)
        return this.rollback(error, 'primary_workspace_persistence_failed_closed')
      }
    })
  }

  private find(projectId: string): Project | undefined {
    return this.deps.projects().find((project) => project.id === projectId)
  }

  private assignSnapshot(
    project: Project,
    primaryWorkspace: Project['primaryWorkspace'] | null | undefined,
    revision: number
  ): void {
    if (primaryWorkspace === undefined) {
      delete project.primaryWorkspace
    } else if (primaryWorkspace === null) {
      project.primaryWorkspace = null as never
    } else {
      project.primaryWorkspace = { ...primaryWorkspace }
    }
    project.primaryWorkspaceRevision = revision
    project.updatedAt = Date.now()
    this.deps.scheduleSave()
  }

  private async flushSave(): Promise<void> {
    await this.deps.flush()
  }

  private async rollback(error: unknown, code: string): Promise<never> {
    try {
      this.deps.scheduleSave()
      await this.flushSave()
    } catch (rollbackError) {
      this.failClosed()
      throw new AggregateError([error, rollbackError], code)
    }
    throw error
  }

  private failClosed(): void {
    this.failedClosed = true
    this.deps.freezeWrites()
  }

  private async withProjectLock<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
    const prior = this.writesByProjectId.get(projectId) ?? Promise.resolve()
    const current = prior.catch(() => undefined).then(operation)
    this.writesByProjectId.set(projectId, current)
    try {
      return await current
    } finally {
      if (this.writesByProjectId.get(projectId) === current) {
        this.writesByProjectId.delete(projectId)
      }
    }
  }
}
