import {
  getRepoExecutionHostId,
  parseExecutionHostId,
  type ExecutionHostId
} from '../../../../shared/execution-host'
import type { Repo } from '../../../../shared/repo-types'

type NativeWorktreeProvenance = {
  hostId?: ExecutionHostId
  ownerHostId?: ExecutionHostId
  peerFingerprint?: string
  runtimeOwnerEnvironmentId?: string
}

/** Stamp only rows owned by this authenticated native host. */
export function stampAuthenticatedNativeWorktreeRows<T extends NativeWorktreeProvenance>(
  rows: T[],
  repo: Repo,
  ownPeerFingerprint: string | null
): T[] {
  const hostId = getRepoExecutionHostId(repo)
  if (!ownPeerFingerprint || parseExecutionHostId(hostId)?.kind === 'runtime') {
    return rows
  }
  return rows.map((row) => {
    const rowOwnerHostId = row.ownerHostId ?? row.hostId ?? hostId
    const parsedRowHost = parseExecutionHostId(rowOwnerHostId)
    if (
      rowOwnerHostId !== hostId ||
      !parsedRowHost ||
      parsedRowHost.kind === 'runtime' ||
      parseExecutionHostId(row.hostId ?? '')?.kind === 'runtime' ||
      row.runtimeOwnerEnvironmentId ||
      (row.peerFingerprint && row.peerFingerprint !== ownPeerFingerprint)
    ) {
      return row
    }
    return { ...row, hostId, ownerHostId: hostId, peerFingerprint: ownPeerFingerprint }
  })
}
