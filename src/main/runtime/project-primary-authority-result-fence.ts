import type {
  ProjectPrimaryAuthorityEvent,
  ProjectPrimaryAuthorityRequestResult
} from '../../shared/project-primary-authority-protocol'
import type { Project } from '../../shared/project-types'

export type ProjectPrimaryAuthorityAttachment = {
  fingerprint: string
  connectionId: string
  epoch: string
  generation: number
  emit: (event: ProjectPrimaryAuthorityEvent) => void
  pending: Map<string, (result: ProjectPrimaryAuthorityRequestResult) => void>
  active: boolean
  finish: () => void
}

export function assertPrimaryAuthorityAttachmentCurrent(
  expected: ProjectPrimaryAuthorityAttachment,
  current: ProjectPrimaryAuthorityAttachment | undefined
): void {
  if (expected !== current) {
    throw new Error('stale_primary_authority_attachment')
  }
}

export function settleFencedPrimaryAuthorityResult(
  attachment: ProjectPrimaryAuthorityAttachment | undefined,
  input: {
    callerFingerprint: string | undefined
    connectionId: string | undefined
    result: ProjectPrimaryAuthorityRequestResult
  }
): { accepted: boolean } {
  if (
    !attachment ||
    !input.callerFingerprint ||
    attachment.fingerprint !== input.callerFingerprint ||
    attachment.connectionId !== input.connectionId ||
    attachment.epoch !== input.result.epoch ||
    attachment.generation !== input.result.generation
  ) {
    return { accepted: false }
  }
  const settle = attachment.pending.get(input.result.requestId)
  if (!settle) {
    return { accepted: false }
  }
  attachment.pending.delete(input.result.requestId)
  settle(input.result)
  return { accepted: true }
}

export async function applyFencedPrimaryAuthoritySnapshot(
  attachment: ProjectPrimaryAuthorityAttachment | undefined,
  input: {
    callerFingerprint: string | undefined
    connectionId: string | undefined
    epoch: string
    generation: number
    projectId: string
    primaryAuthorityFingerprint: string
    primaryWorkspace: Project['primaryWorkspace'] | null | undefined
    revision: number
  },
  runtime: {
    listProjects: () => Project[]
    applyPrimaryAuthoritySnapshot: (args: {
      projectId: string
      fingerprint: string
      primaryWorkspace: Project['primaryWorkspace'] | null | undefined
      revision: number
    }) => Promise<Project>
  }
): Promise<{ accepted: boolean }> {
  if (
    !attachment?.active ||
    !input.callerFingerprint ||
    attachment.fingerprint !== input.callerFingerprint ||
    attachment.connectionId !== input.connectionId ||
    attachment.epoch !== input.epoch ||
    attachment.generation !== input.generation ||
    input.primaryAuthorityFingerprint !== input.callerFingerprint ||
    (input.primaryWorkspace?.authorityFingerprint !== undefined &&
      input.primaryWorkspace.authorityFingerprint !== input.callerFingerprint)
  ) {
    return { accepted: false }
  }
  const project = runtime.listProjects().find((entry) => entry.id === input.projectId)
  if (!project || project.primaryAuthorityFingerprint !== input.callerFingerprint) {
    return { accepted: false }
  }
  await runtime.applyPrimaryAuthoritySnapshot({
    projectId: input.projectId,
    fingerprint: input.callerFingerprint,
    primaryWorkspace: input.primaryWorkspace,
    revision: input.revision
  })
  return { accepted: true }
}
