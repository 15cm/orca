import { randomUUID } from 'node:crypto'
import type { Project, ProjectPrimarySelector } from '../../shared/project-types'
import type {
  ProjectPrimaryAuthorityEvent,
  ProjectPrimaryAuthorityRequestResult
} from '../../shared/project-primary-authority-protocol'
import type { PrimaryWorkspaceTarget } from '../../shared/project-primary-removal'
import { persistPrimaryAuthorityResult } from './project-primary-authority-result-persistence'
import {
  assertPrimaryAuthorityAttachmentCurrent,
  settleFencedPrimaryAuthorityResult,
  type ProjectPrimaryAuthorityAttachment
} from './project-primary-authority-result-fence'

type AuthorityRuntime = {
  isDesktopPrimaryAuthority?: () => boolean
  listProjects?: () => Project[]
  bindPrimaryAuthorityFingerprint?: (projectId: string, fingerprint: string) => Promise<Project>
  applyPrimaryAuthoritySnapshot?: (input: {
    projectId: string
    fingerprint: string
    primaryWorkspace: Project['primaryWorkspace'] | null | undefined
    revision: number
  }) => Promise<Project>
  setPrimaryWorkspace?: (args: ProjectPrimarySelector) => Promise<Project>
  beginPrimaryRemoval?: (projectId: string, target: PrimaryWorkspaceTarget) => Promise<string>
  recordPrimaryRemovalCompletion?: (token: string, target: PrimaryWorkspaceTarget) => Promise<void>
  finishPrimaryRemoval?: (token: string, target: PrimaryWorkspaceTarget) => Promise<boolean>
}

type Attachment = ProjectPrimaryAuthorityAttachment
const registries = new WeakMap<object, ProjectPrimaryAuthorityRegistry>()

export function getProjectPrimaryAuthorityRegistry(
  runtime: object
): ProjectPrimaryAuthorityRegistry {
  let registry = registries.get(runtime)
  if (!registry) {
    registry = new ProjectPrimaryAuthorityRegistry(runtime as AuthorityRuntime)
    registries.set(runtime, registry)
  }
  return registry
}
export class ProjectPrimaryAuthorityRegistry {
  private readonly attachmentByProjectId = new Map<string, Attachment>()
  private readonly generationByProjectId = new Map<string, number>()

  constructor(private readonly runtime: AuthorityRuntime) {}

  getAttachment(projectId: string): Attachment | undefined {
    return this.attachmentByProjectId.get(projectId)
  }

  async attach(input: {
    projectIds: readonly string[]
    fingerprint: string
    connectionId: string
    emit: (event: ProjectPrimaryAuthorityEvent) => void
    signal?: AbortSignal
  }): Promise<void> {
    if (this.runtime.isDesktopPrimaryAuthority?.() !== false) {
      throw new Error('primary_authority_peer_required')
    }
    if (!input.fingerprint || !input.connectionId) {
      throw new Error('authenticated_primary_authority_required')
    }
    const projects = this.runtime.listProjects?.() ?? []
    const distinctProjectIds = [...new Set(input.projectIds)]
    if (distinctProjectIds.length === 0) {
      throw new Error('primary_authority_projects_required')
    }
    const projectById = new Map(projects.map((project) => [project.id, project]))
    for (const projectId of distinctProjectIds) {
      const project = projectById.get(projectId)
      if (!project) {
        throw new Error(`Project not found: ${projectId}`)
      }
      const binding = project.primaryAuthorityFingerprint
      if (binding !== undefined && binding !== input.fingerprint) {
        throw new Error('primary_authority_conflict')
      }
      const savedAuthority = project.primaryWorkspace?.authorityFingerprint
      if (savedAuthority !== undefined && savedAuthority !== input.fingerprint) {
        throw new Error('primary_authority_conflict')
      }
    }
    // Validate the full batch before the first durable write so a later conflict
    // cannot leave earlier projects bound to a peer whose attachment was rejected.
    for (const projectId of distinctProjectIds) {
      await this.requireRuntimeMethod('bindPrimaryAuthorityFingerprint')(
        projectId,
        input.fingerprint
      )
    }
    const attachments = new Map<string, Attachment>()
    for (const projectId of distinctProjectIds) {
      const generation = (this.generationByProjectId.get(projectId) ?? 0) + 1
      this.generationByProjectId.set(projectId, generation)
      const current = this.attachmentByProjectId.get(projectId)
      if (current) {
        this.disconnect(current)
      }
      const attachment: Attachment = {
        fingerprint: input.fingerprint,
        connectionId: input.connectionId,
        epoch: randomUUID(),
        generation,
        emit: input.emit,
        pending: new Map(),
        active: false,
        finish: () => {}
      }
      this.attachmentByProjectId.set(projectId, attachment)
      attachments.set(projectId, attachment)
    }

    let finish!: () => void
    const disconnected = new Promise<void>((resolve) => (finish = resolve))
    for (const attachment of attachments.values()) {
      attachment.finish = finish
    }
    const disconnect = (): void => {
      for (const [projectId, attachment] of attachments) {
        if (this.attachmentByProjectId.get(projectId) === attachment) {
          this.attachmentByProjectId.delete(projectId)
        }
        this.disconnect(attachment)
      }
      finish()
    }
    input.signal?.addEventListener('abort', disconnect, { once: true })
    if (input.signal?.aborted) {
      disconnect()
    }
    try {
      for (const [projectId, attachment] of attachments) {
        const result = await this.request(attachment, projectId, 'snapshot')
        assertPrimaryAuthorityAttachmentCurrent(
          attachment,
          this.attachmentByProjectId.get(projectId)
        )
        await this.persistResult(projectId, attachment.fingerprint, result)
        assertPrimaryAuthorityAttachmentCurrent(
          attachment,
          this.attachmentByProjectId.get(projectId)
        )
        attachment.active = true
      }
      for (const [projectId, attachment] of attachments) {
        input.emit({
          type: 'ready',
          epoch: attachment.epoch,
          generation: attachment.generation,
          projectIds: [projectId]
        })
      }
      await disconnected
    } finally {
      input.signal?.removeEventListener('abort', disconnect)
      disconnect()
    }
  }

  async handleResult(input: {
    callerFingerprint: string | undefined
    connectionId: string | undefined
    result: ProjectPrimaryAuthorityRequestResult
  }): Promise<{ accepted: boolean }> {
    return settleFencedPrimaryAuthorityResult(
      this.attachmentByProjectId.get(input.result.projectId),
      input
    )
  }
  async forwardSet(projectId: string, args: ProjectPrimarySelector): Promise<Project> {
    const attachment = this.requireAttachment(projectId)
    const result = await this.request(attachment, projectId, 'set', {
      selector: args.worktree,
      ...(args.hostId ? { hostId: args.hostId } : {})
    })
    assertPrimaryAuthorityAttachmentCurrent(attachment, this.attachmentByProjectId.get(projectId))
    return this.persistResult(projectId, attachment.fingerprint, result)
  }

  async beginRemoval(projectId: string, target: PrimaryWorkspaceTarget): Promise<string> {
    const attachment = this.requireAttachment(projectId)
    const result = await this.request(attachment, projectId, 'remove.begin', { target })
    if (!result.ok || !result.removalToken) {
      throw new Error(result.error ?? 'primary_authority_unavailable')
    }
    return result.removalToken
  }

  async finishRemoval(
    projectId: string,
    token: string,
    target: PrimaryWorkspaceTarget
  ): Promise<void> {
    const attachment = this.requireAttachment(projectId)
    const result = await this.request(attachment, projectId, 'remove.finish', { token, target })
    if (!result.ok) {
      throw new Error(result.error ?? 'primary_authority_unavailable')
    }
    assertPrimaryAuthorityAttachmentCurrent(attachment, this.attachmentByProjectId.get(projectId))
    await this.persistResult(projectId, attachment.fingerprint, result)
  }

  async authorizeSetupRemoval<T>(
    projectId: string,
    setupId: string,
    operation: () => Promise<T>
  ): Promise<T> {
    return this.withProjectRemovalAuthorization(projectId, 'remove.setup', { setupId }, operation)
  }

  async authorizeProjectRemoval<T>(
    projectId: string,
    repoId: string,
    operation: () => Promise<T>
  ): Promise<T> {
    return this.withProjectRemovalAuthorization(projectId, 'remove.project', { repoId }, operation)
  }

  private async withProjectRemovalAuthorization<T>(
    projectId: string,
    operation: 'remove.setup' | 'remove.project',
    resource: { setupId: string } | { repoId: string },
    run: () => Promise<T>
  ): Promise<T> {
    const attachment = this.requireAttachment(projectId)
    const begin = await this.request(attachment, projectId, operation, {
      ...resource,
      authorizationPhase: 'begin'
    })
    if (!begin.ok || !begin.removalToken) {
      throw new Error(begin.error ?? 'primary_authority_unavailable')
    }
    let result: T
    try {
      result = await run()
      if (
        result !== null &&
        typeof result === 'object' &&
        'ok' in result &&
        result.ok === false
      ) {
        throw new Error(
          'error' in result && typeof result.error === 'string'
            ? result.error
            : 'primary_project_removal_failed'
        )
      }
    } catch (error) {
      // Unknown side effects keep the durable permit until the owner can confirm recovery.
      throw error
    }
    const finish = await this.request(attachment, projectId, operation, {
      ...resource,
      authorizationPhase: 'finish',
      token: begin.removalToken
    })
    if (!finish.ok) {
      throw new Error(finish.error ?? 'primary_authority_unavailable')
    }
    assertPrimaryAuthorityAttachmentCurrent(attachment, this.attachmentByProjectId.get(projectId))
    return result
  }

  private async request(
    attachment: Attachment,
    projectId: string,
    operation:
      | 'snapshot'
      | 'set'
      | 'remove.begin'
      | 'remove.finish'
      | 'remove.setup'
      | 'remove.project',
    detail: {
      selector?: string
      hostId?: string
      token?: string
      target?: PrimaryWorkspaceTarget
      setupId?: string
      repoId?: string
      authorizationPhase?: 'begin' | 'finish'
    } = {}
  ): Promise<ProjectPrimaryAuthorityRequestResult> {
    if (
      attachment !== this.attachmentByProjectId.get(projectId) ||
      (!attachment.active && operation !== 'snapshot')
    ) {
      throw new Error('primary_authority_unavailable')
    }
    const requestId = randomUUID()
    const pending = new Promise<ProjectPrimaryAuthorityRequestResult>((resolve) => {
      attachment.pending.set(requestId, resolve)
    })
    attachment.emit({
      type: 'request',
      operation,
      requestId,
      epoch: attachment.epoch,
      generation: attachment.generation,
      projectId,
      ...detail
    })
    const timeout = setTimeout(() => {
      const settle = attachment.pending.get(requestId)
      if (!settle) {
        return
      }
      attachment.pending.delete(requestId)
      settle({
        requestId,
        epoch: attachment.epoch,
        generation: attachment.generation,
        projectId,
        ok: false,
        error: 'primary_authority_timeout'
      })
    }, 15_000)
    try {
      const result = await pending
      assertPrimaryAuthorityAttachmentCurrent(attachment, this.attachmentByProjectId.get(projectId))
      if (
        result.requestId !== requestId ||
        result.projectId !== projectId ||
        result.epoch !== attachment.epoch ||
        result.generation !== attachment.generation
      ) {
        throw new Error('stale_primary_authority_result')
      }
      return result
    } finally {
      clearTimeout(timeout)
    }
  }

  private async persistResult(
    projectId: string,
    fingerprint: string,
    result: ProjectPrimaryAuthorityRequestResult
  ): Promise<Project> {
    return persistPrimaryAuthorityResult(
      { applyPrimaryAuthoritySnapshot: this.requireRuntimeMethod('applyPrimaryAuthoritySnapshot') },
      projectId,
      fingerprint,
      result
    )
  }

  private requireAttachment(projectId: string): Attachment {
    const attachment = this.attachmentByProjectId.get(projectId)
    if (!attachment?.active) {
      throw new Error('primary_authority_unavailable')
    }
    return attachment
  }

  private disconnect(attachment: Attachment): void {
    if (!attachment.active && attachment.pending.size === 0) {
      attachment.finish()
      return
    }
    attachment.active = false
    for (const [requestId, settle] of attachment.pending) {
      settle({
        requestId,
        epoch: attachment.epoch,
        generation: attachment.generation,
        projectId: '',
        ok: false,
        error: 'primary_authority_disconnected'
      })
    }
    attachment.pending.clear()
    attachment.emit({
      type: 'disconnected',
      epoch: attachment.epoch,
      generation: attachment.generation
    })
    attachment.finish()
  }

  private requireRuntimeMethod<K extends keyof AuthorityRuntime>(
    name: K
  ): NonNullable<AuthorityRuntime[K]> {
    const method = this.runtime[name]
    if (typeof method !== 'function') {
      throw new Error('primary_authority_unavailable')
    }
    return method.bind(this.runtime) as NonNullable<AuthorityRuntime[K]>
  }
}
