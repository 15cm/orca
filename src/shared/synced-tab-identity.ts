import type { ExecutionHostId } from './execution-host'
import { sha256 } from './sha256'

export type SyncedTabIdentityTuple = {
  executionHostId?: ExecutionHostId | null
  workspaceKey: string
  catalogTabId: string
}
export type SyncedIdentityKind = 'tab' | 'entity' | 'page'

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Stable opaque key derived from ordered identity tuple. */
export function makeSyncedTabIdentity(
  tuple: SyncedTabIdentityTuple,
  kind: SyncedIdentityKind = 'tab'
): string {
  const payload = JSON.stringify([
    kind,
    tuple.executionHostId ?? 'local',
    tuple.workspaceKey,
    tuple.catalogTabId
  ])
  return `stc_${bytesToHex(sha256(new TextEncoder().encode(payload)))}`
}
