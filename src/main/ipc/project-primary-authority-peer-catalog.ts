import { resolveEnvironment } from '../../shared/runtime-environment-store'
import { getPreferredPairingOffer } from '../../shared/runtime-environments'
import { normalizeExecutionHostId } from '../../shared/execution-host'
import type { ResolvedWorktree } from '../runtime/runtime-worktree-path-identity'
import type { Store } from '../persistence'
import { fingerprintPeerPublicKey } from '../runtime/peer-fingerprint'
import { callRuntimeEnvironment } from './runtime-environment-transport-routing'

type Row = Record<string, unknown>

function isRow(value: unknown): value is Row {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function resolveWorktreeRow(value: unknown, environmentId: string, fingerprint: string): ResolvedWorktree | null {
  if (
    !isRow(value) ||
    typeof value.id !== 'string' ||
    typeof value.repoId !== 'string' ||
    typeof value.path !== 'string' ||
    typeof value.instanceId !== 'string' ||
    !value.instanceId ||
    typeof value.peerFingerprint !== 'string' ||
    value.peerFingerprint !== fingerprint ||
    typeof value.ownerHostId !== 'string' ||
    normalizeExecutionHostId(value.ownerHostId) !== value.ownerHostId ||
    typeof value.head !== 'string' ||
    typeof value.branch !== 'string' ||
    typeof value.isBare !== 'boolean' ||
    typeof value.isMainWorktree !== 'boolean'
  ) {
    return null
  }
  const hostId = `runtime:${environmentId}` as const
  return {
    ...value,
    hostId,
    runtimeOwnerEnvironmentId: environmentId,
    parentWorktreeId: null,
    childWorktreeIds: [],
    lineage: null,
    git: {
      path: value.path,
      head: value.head,
      branch: value.branch,
      isBare: value.isBare,
      isMainWorktree: value.isMainWorktree,
      ...(typeof value.prunable === 'boolean' ? { prunable: value.prunable } : {})
    }
  } as unknown as ResolvedWorktree
}

export async function listAuthenticatedProjectPeerWorktrees(
  store: Store,
  userDataPath: string,
  projectId: string,
  environmentId: string
): Promise<ResolvedWorktree[]> {
  const hostId = `runtime:${environmentId}`
  const setups = store
    .getProjectHostSetups()
    .filter(
      (setup) =>
        setup.projectId === projectId && setup.hostId === hostId && setup.setupState === 'ready'
    )
  if (setups.length === 0) {
    throw new Error('primary_workspace_wrong_project')
  }

  const environment = resolveEnvironment(userDataPath, environmentId)
  const pairingRevision = environment.pairingRevision ?? environment.createdAt
  const fingerprint = fingerprintPeerPublicKey(getPreferredPairingOffer(environment).publicKeyB64)
  const results = await Promise.all(
    [...new Set(setups.map((setup) => setup.repoId))].map(async (repoId) => {
      const response = await callRuntimeEnvironment(
        userDataPath,
        environmentId,
        'worktree.detectedList',
        { repo: `id:${repoId}` },
        15_000,
        pairingRevision
      )
      if (!response.ok) {
        if (response.error.code === 'method_not_found') {
          throw new Error('primary_authority_peer_incompatible')
        }
        throw new Error('primary_workspace_owner_unavailable')
      }
      if (
        !isRow(response.result) ||
        response.result.authoritative !== true ||
        !Array.isArray(response.result.worktrees)
      ) {
        throw new Error('primary_workspace_owner_unverifiable')
      }
      return response.result.worktrees
        .map((row) => resolveWorktreeRow(row, environmentId, fingerprint))
        .filter((row): row is ResolvedWorktree => row !== null)
    })
  )
  const currentEnvironment = resolveEnvironment(userDataPath, environmentId)
  const currentPairing = getPreferredPairingOffer(currentEnvironment)
  if (
    (currentEnvironment.pairingRevision ?? currentEnvironment.createdAt) !== pairingRevision ||
    fingerprintPeerPublicKey(currentPairing.publicKeyB64) !== fingerprint
  ) {
    throw new Error('runtime_environment_changed')
  }
  return results.flat()
}
