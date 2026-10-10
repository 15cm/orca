import { z } from 'zod'
import { ProjectPrimarySet } from './rpc-contract/project-runtime-params'
import { isCanonicalNativeExecutionHostId } from './execution-host'

const PrimaryHostId = z.string().transform((value, context) => {
  if (!isCanonicalNativeExecutionHostId(value)) {
    context.addIssue({ code: 'custom', message: 'Invalid primary workspace host ID' })
    return z.NEVER
  }
  return value
})

export const ProjectPrimaryAuthorityWorkspaceParams = z.object({
  worktreeId: z.string().min(1),
  instanceId: z.string().min(1),
  hostId: PrimaryHostId,
  path: z.string().min(1),
  peerFingerprint: z.string().min(1),
  authorityFingerprint: z.string().min(1)
})

export const PROJECT_PRIMARY_AUTHORITY_PROTOCOL_VERSION = 1 as const

export const ProjectPrimaryAuthorityAttachParams = z.object({
  projectIds: z.array(z.string().min(1).max(256)).max(512)
})

export const ProjectPrimaryAuthorityRequestResultParams = z.object({
  requestId: z.string().min(1).max(128),
  epoch: z.string().min(1).max(128),
  generation: z.number().int().positive(),
  projectId: z.string().min(1).max(256),
  ok: z.boolean(),
  primaryWorkspace: ProjectPrimaryAuthorityWorkspaceParams.nullable().optional(),
  revision: z.number().int().nonnegative().optional(),
  primaryAuthorityFingerprint: z.string().min(1).max(256).optional(),
  removalToken: z.string().min(1).max(128).optional(),
  error: z.string().min(1).max(512).optional()
})

export const ProjectPrimaryAuthoritySnapshotParams = z.object({
  kind: z.literal('snapshot'),
  epoch: z.string().min(1).max(128),
  generation: z.number().int().positive(),
  projectId: z.string().min(1).max(256),
  primaryAuthorityFingerprint: z.string().min(1).max(256),
  revision: z.number().int().nonnegative(),
  primaryWorkspace: ProjectPrimaryAuthorityWorkspaceParams.nullable().optional()
})

export const ProjectPrimaryAuthorityResultOrSnapshotParams = z.union([
  ProjectPrimaryAuthorityRequestResultParams,
  ProjectPrimaryAuthoritySnapshotParams
])

export const ProjectPrimaryAuthorityForwardSetParams = z.object({
  ...ProjectPrimarySet.shape
})

export type ProjectPrimaryAuthorityRequestResult = z.infer<
  typeof ProjectPrimaryAuthorityRequestResultParams
>

export type ProjectPrimaryAuthorityEvent =
  | {
      type: 'request'
      operation: 'snapshot' | 'set' | 'remove.begin' | 'remove.finish' | 'remove.setup' | 'remove.project'
      authorizationPhase?: 'begin' | 'finish'
      requestId: string
      epoch: string
      generation: number
      projectId: string
      selector?: string
      hostId?: string
      token?: string
      target?: { peerFingerprint: string; hostId: string; instanceId: string; path?: string }
      setupId?: string
      repoId?: string
    }
  | { type: 'ready'; epoch: string; generation: number; projectIds: string[] }
  | { type: 'disconnected'; epoch: string; generation: number }
