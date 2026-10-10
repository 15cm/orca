import { describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  environment: { id: 'peer-a', pairingRevision: 7, createdAt: 1 },
  response: {
    id: 'worktree.detectedList',
    ok: true,
    result: {
      repoId: 'repo-a',
      authoritative: true,
      source: 'git',
      worktrees: [
        {
          id: 'repo-a::/peer/worktree',
          repoId: 'repo-a',
          path: '/peer/worktree',
          instanceId: 'peer-instance',
          head: 'head',
          branch: 'main',
          isBare: false,
          isMainWorktree: false,
          hostId: 'local',
          ownerHostId: 'local',
          peerFingerprint: ''
        }
      ]
    }
  },
  currentFingerprint: 'peer-key',
  call: vi.fn()
}))

vi.mock('../../shared/runtime-environment-store', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveEnvironment: () => state.environment
}))
vi.mock('../../shared/runtime-environments', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPreferredPairingOffer: () => ({ publicKeyB64: state.currentFingerprint, endpoint: 'ws://peer' })
}))
vi.mock('../runtime/peer-fingerprint', () => ({
  fingerprintPeerPublicKey: (key: string) => key
}))
vi.mock('./runtime-environment-transport-routing', () => ({
  callRuntimeEnvironment: state.call
}))

import { listAuthenticatedProjectPeerWorktrees } from './project-primary-authority-peer-catalog'

function createStore() {
  return {
    getProjectHostSetups: () => [
      {
        id: 'setup-a',
        projectId: 'project-a',
        repoId: 'repo-a',
        hostId: 'runtime:peer-a',
        setupState: 'ready'
      }
    ]
  } as never
}

describe('authenticated primary authority peer catalog', () => {
  it('uses the paired live detected catalog and maps its owner into the runtime host', async () => {
    state.response.result.worktrees[0]!.peerFingerprint = state.currentFingerprint
    state.call.mockResolvedValue(state.response)

    const rows = await listAuthenticatedProjectPeerWorktrees(
      createStore(),
      '/user-data',
      'project-a',
      'peer-a'
    )

    expect(state.call).toHaveBeenCalledWith(
      '/user-data',
      'peer-a',
      'worktree.detectedList',
      { repo: 'id:repo-a' },
      15_000,
      7
    )
    expect(rows[0]).toMatchObject({
      hostId: 'runtime:peer-a',
      ownerHostId: 'local',
      runtimeOwnerEnvironmentId: 'peer-a',
      peerFingerprint: 'peer-key',
      instanceId: 'peer-instance',
      git: { path: '/peer/worktree', head: 'head', branch: 'main' }
    })
  })

  it('rejects stale, unsupported, and non-authoritative peer catalogs', async () => {
    state.call.mockResolvedValue({
      id: 'worktree.detectedList',
      ok: true,
      result: { authoritative: false, worktrees: [] }
    })
    await expect(
      listAuthenticatedProjectPeerWorktrees(createStore(), '/user-data', 'project-a', 'peer-a')
    ).rejects.toThrow('primary_workspace_owner_unverifiable')

    state.call.mockResolvedValue({
      id: 'worktree.detectedList',
      ok: false,
      error: { code: 'method_not_found', message: 'unknown method' }
    })
    await expect(
      listAuthenticatedProjectPeerWorktrees(createStore(), '/user-data', 'project-a', 'peer-a')
    ).rejects.toThrow('primary_authority_peer_incompatible')
  })
})
