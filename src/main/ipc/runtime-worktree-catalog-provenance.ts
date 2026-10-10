import { fingerprintPeerPublicKey } from '../runtime/peer-fingerprint'
import type { RuntimeRpcResponse } from '../../shared/runtime-rpc-envelope'
const CATALOG_METHODS = new Set([
  'worktree.list',
  'worktree.listDetected',
  'worktree.detectedList',
  'worktree.show',
  'worktree.current'
])
export function isWorktreeCatalogMethod(method: string): boolean {
  return CATALOG_METHODS.has(method)
}
type Row = Record<string, unknown>
const isRow = (value: unknown): value is Row =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value))
export function stampAuthenticatedCatalogResponse(
  method: string,
  response: RuntimeRpcResponse<unknown>,
  publicKeyB64: string
): RuntimeRpcResponse<unknown> {
  if (!response.ok || !isWorktreeCatalogMethod(method)) {
    return response
  }
  const fingerprint = fingerprintPeerPublicKey(publicKeyB64)
  const stamp = (source: Row): Row => {
    const row = { ...source }
    const runtime =
      (typeof row.hostId === 'string' && row.hostId.startsWith('runtime:')) ||
      typeof row.runtimeOwnerEnvironmentId === 'string'
    if (runtime) {
      delete row.peerFingerprint
      delete row.ownerHostId
    } else if (
      typeof row.hostId === 'string' &&
      (row.hostId === 'local' || /^ssh:[^:]+$/.test(row.hostId))
    ) {
      row.peerFingerprint = fingerprint
      row.ownerHostId = row.hostId
    } else {
      delete row.peerFingerprint
      delete row.ownerHostId
    }
    return row
  }
  const data = response.result
  let result: unknown = data
  if (Array.isArray(data)) {
    result = data.map((row) => (isRow(row) ? stamp(row) : row))
  } else if (isRow(data) && Array.isArray(data.worktrees)) {
    result = { ...data, worktrees: data.worktrees.map((row) => (isRow(row) ? stamp(row) : row)) }
  } else if (isRow(data) && isRow(data.worktree)) {
    result = { ...data, worktree: stamp(data.worktree) }
  }
  return { ...response, result }
}
