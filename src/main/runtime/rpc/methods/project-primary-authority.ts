import { PROJECT_PRIMARY_AUTHORITY_RUNTIME_CAPABILITY } from '../../../../shared/protocol-version'
import {
  ProjectPrimaryAuthorityAttachParams,
  ProjectPrimaryAuthorityResultOrSnapshotParams
} from '../../../../shared/project-primary-authority-protocol'
import { getProjectPrimaryAuthorityRegistry } from '../../project-primary-authority-registry'
import { applyFencedPrimaryAuthoritySnapshot } from '../../project-primary-authority-result-fence'
import { defineMethod, defineStreamingMethod } from '../core'

function requireAuthorityPeer(context: {
  clientKind?: 'mobile' | 'runtime'
  clientCapabilities?: readonly string[]
  connectionId?: string
  authenticatedCallerFingerprint?: string
}): { connectionId: string; fingerprint: string } {
  if (
    context.clientKind !== 'runtime' ||
    !context.connectionId ||
    !context.authenticatedCallerFingerprint
  ) {
    throw new Error('authenticated_primary_authority_required')
  }
  if (!context.clientCapabilities?.includes(PROJECT_PRIMARY_AUTHORITY_RUNTIME_CAPABILITY)) {
    throw new Error('primary_authority_capability_required')
  }
  return {
    connectionId: context.connectionId,
    fingerprint: context.authenticatedCallerFingerprint
  }
}

export const PROJECT_PRIMARY_AUTHORITY_METHODS = [
  defineStreamingMethod({
    name: 'project.primary.authority.attach',
    params: ProjectPrimaryAuthorityAttachParams,
    handler: async (params, context, emit) => {
      const caller = requireAuthorityPeer(context)
      await getProjectPrimaryAuthorityRegistry(context.runtime).attach({
        projectIds: params.projectIds,
        fingerprint: caller.fingerprint,
        connectionId: caller.connectionId,
        emit: (event) => emit(event),
        ...(context.signal ? { signal: context.signal } : {})
      })
    }
  }),
  defineMethod({
    name: 'project.primary.authority.requestResult',
    params: ProjectPrimaryAuthorityResultOrSnapshotParams,
    handler: async (params, context) => {
      const caller = requireAuthorityPeer(context)
      if (!('requestId' in params)) {
        return applyFencedPrimaryAuthoritySnapshot(
          getProjectPrimaryAuthorityRegistry(context.runtime).getAttachment(params.projectId),
          {
            ...params,
            callerFingerprint: caller.fingerprint,
            connectionId: caller.connectionId,
            primaryWorkspace: params.primaryWorkspace
          },
          context.runtime
        )
      }
      return getProjectPrimaryAuthorityRegistry(context.runtime).handleResult({
        callerFingerprint: caller.fingerprint,
        connectionId: caller.connectionId,
        result: params
      })
    }
  })
]
