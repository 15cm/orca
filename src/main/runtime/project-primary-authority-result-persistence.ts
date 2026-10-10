import type { Project } from '../../shared/project-types'
import type { ProjectPrimaryAuthorityRequestResult } from '../../shared/project-primary-authority-protocol'
import { normalizeExecutionHostId } from '../../shared/execution-host'

export type PrimaryAuthoritySnapshotWriter = {
  applyPrimaryAuthoritySnapshot: (input: {
    projectId: string
    fingerprint: string
    primaryWorkspace: Project['primaryWorkspace'] | null | undefined
    revision: number
  }) => Promise<Project>
}

export async function persistPrimaryAuthorityResult(
  runtime: PrimaryAuthoritySnapshotWriter,
  projectId: string,
  fingerprint: string,
  result: ProjectPrimaryAuthorityRequestResult
): Promise<Project> {
  if (!result.ok) {
    throw new Error(result.error ?? 'primary_authority_rejected')
  }
  if (result.primaryAuthorityFingerprint !== fingerprint || result.revision === undefined) {
    throw new Error('invalid_primary_authority_snapshot')
  }
  if (
    result.primaryWorkspace?.authorityFingerprint !== undefined &&
    result.primaryWorkspace.authorityFingerprint !== fingerprint
  ) {
    throw new Error('primary_authority_conflict')
  }
  let primaryWorkspace: Project['primaryWorkspace'] | null | undefined
  if (result.primaryWorkspace === null) {
    primaryWorkspace = null
  } else if (result.primaryWorkspace) {
    const hostId = normalizeExecutionHostId(result.primaryWorkspace.hostId)
    if (!hostId) {
      throw new Error('invalid_primary_authority_snapshot')
    }
    primaryWorkspace = { ...result.primaryWorkspace, hostId }
  }
  return runtime.applyPrimaryAuthoritySnapshot({
    projectId,
    fingerprint,
    primaryWorkspace,
    revision: result.revision
  })
}
