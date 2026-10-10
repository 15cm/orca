import { describe, expect, it } from 'vitest'
import { stampAuthenticatedCatalogResponse } from './runtime-worktree-catalog-provenance'
import { fingerprintPeerPublicKey } from '../runtime/peer-fingerprint'

const response = (result: unknown) => ({
  id: 'worktree.list',
  ok: true as const,
  result,
  _meta: { runtimeId: 'r' }
})

describe('authenticated worktree catalog provenance', () => {
  it('overrides spoofed local claims and preserves input', () => {
    const row = { id: 'w', hostId: 'local', peerFingerprint: 'spoof' }
    const result = stampAuthenticatedCatalogResponse(
      'worktree.list',
      response({ worktrees: [row] }),
      'a2V5'
    )
    if (!result.ok) {
      throw new Error('unexpected failure')
    }
    expect((result.result as { worktrees: Record<string, unknown>[] }).worktrees[0]).toMatchObject({
      ownerHostId: 'local',
      peerFingerprint: fingerprintPeerPublicKey('a2V5')
    })
    expect(row.peerFingerprint).toBe('spoof')
  })
  it('strips foreign runtime identity and leaves malformed and noncatalog data safe', () => {
    const row = { id: 'w', hostId: 'runtime:env', peerFingerprint: 'spoof', ownerHostId: 'local' }
    const result = stampAuthenticatedCatalogResponse(
      'worktree.list',
      response([row, null, 3]),
      'a2V5'
    )
    if (!result.ok) {
      throw new Error('unexpected failure')
    }
    expect((result.result as Record<string, unknown>[])[0]).not.toHaveProperty('peerFingerprint')
    const untouched = stampAuthenticatedCatalogResponse('repo.list', response({ x: 1 }), 'a2V5')
    if (!untouched.ok) {
      throw new Error('unexpected failure')
    }
    expect(untouched.result).toEqual({ x: 1 })
  })
  it('stamps ssh owner and current shape', () => {
    const result = stampAuthenticatedCatalogResponse(
      'worktree.current',
      response({ worktree: { hostId: 'ssh:box' } }),
      'a2V5'
    )
    if (!result.ok) {
      throw new Error('unexpected failure')
    }
    expect((result.result as { worktree: Record<string, unknown> }).worktree.ownerHostId).toBe(
      'ssh:box'
    )
  })
  it('stamps the detected worktree method used for authoritative owner scans', () => {
    const result = stampAuthenticatedCatalogResponse(
      'worktree.detectedList',
      response({ worktrees: [{ id: 'w', hostId: 'local' }] }),
      'a2V5'
    )
    if (!result.ok) {
      throw new Error('unexpected failure')
    }
    expect((result.result as { worktrees: Record<string, unknown>[] }).worktrees[0]).toMatchObject({
      peerFingerprint: fingerprintPeerPublicKey('a2V5'),
      ownerHostId: 'local'
    })
  })
  it('strips provenance from rows with missing or malformed host identity', () => {
    const result = stampAuthenticatedCatalogResponse(
      'worktree.list',
      response({
        worktrees: [
          { id: 'old', peerFingerprint: 'spoof', ownerHostId: 'local' },
          { id: 'bad', hostId: 'runtime:env', peerFingerprint: 'spoof', ownerHostId: 'ssh:box' },
          { id: 'invalid', hostId: 'ssh:', peerFingerprint: 'spoof', ownerHostId: 'local' }
        ]
      }),
      'a2V5'
    )
    if (!result.ok) {
      throw new Error('unexpected failure')
    }
    const rows = (result.result as { worktrees: Record<string, unknown>[] }).worktrees
    for (const row of rows) {
      expect(row).not.toHaveProperty('peerFingerprint')
      expect(row).not.toHaveProperty('ownerHostId')
    }
  })
})
