import { describe, expect, it } from 'vitest'
import { resolveProjectPrimaryWorkspace } from './project-primary-workspace'

const project = (primary: Record<string, unknown>) =>
  ({ id: 'p', sourceRepoIds: [], createdAt: 0, updatedAt: 0, ...primary }) as never

describe('resolveProjectPrimaryWorkspace', () => {
  it('requires unique owner identity and follows renamed locators', () => {
    const p = project({
      primaryWorkspace: {
        instanceId: 'i',
        hostId: 'local',
        peerFingerprint: 'a',
        authorityFingerprint: 'authority',
        path: '/old',
        worktreeId: 'old'
      }
    })
    const row = { id: 'new', path: '/new', instanceId: 'i', hostId: 'local', peerFingerprint: 'a' }
    expect(resolveProjectPrimaryWorkspace(p, [row])).toBe(row)
    expect(resolveProjectPrimaryWorkspace(p, [{ ...row, peerFingerprint: 'b' }])).toBeUndefined()
  })

  it('accepts paired runtime projection only with matching environment owner', () => {
    const p = project({
      primaryWorkspace: {
        instanceId: 'i',
        hostId: 'local',
        peerFingerprint: 'a',
        authorityFingerprint: 'authority',
        path: '/x',
        worktreeId: 'x'
      }
    })
    const row = {
      id: 'x',
      path: '/x',
      instanceId: 'i',
      hostId: 'runtime:env',
      ownerHostId: 'local',
      runtimeOwnerEnvironmentId: 'env',
      peerFingerprint: 'a'
    }
    expect(resolveProjectPrimaryWorkspace(p, [row])).toBe(row)
    expect(
      resolveProjectPrimaryWorkspace(p, [{ ...row, ownerHostId: 'ssh:other' }])
    ).toBeUndefined()
  })

  it('keeps rows unavailable when a saved identity revision is malformed', () => {
    const p = project({
      primaryWorkspace: {
        instanceId: 'i',
        hostId: 'local',
        peerFingerprint: 'a',
        authorityFingerprint: 'authority',
        path: '/x',
        worktreeId: 'x'
      },
      primaryWorkspaceRevision: Number.NaN
    })
    const row = { id: 'x', path: '/x', instanceId: 'i', hostId: 'local', peerFingerprint: 'a' }

    expect(resolveProjectPrimaryWorkspace(p, [row])).toBeUndefined()
  })

  it('rejects null revisions, blank identity fields, missing instances, and conflicting owners', () => {
    const saved = {
      instanceId: 'i',
      hostId: 'local',
      peerFingerprint: 'a',
      authorityFingerprint: 'authority',
      path: '/x',
      worktreeId: 'x'
    }
    const row = {
      id: 'x',
      path: '/x',
      instanceId: 'i',
      hostId: 'local',
      peerFingerprint: 'a'
    }
    expect(
      resolveProjectPrimaryWorkspace(
        project({ primaryWorkspace: saved, primaryWorkspaceRevision: null }),
        [row]
      )
    ).toBeUndefined()
    expect(
      resolveProjectPrimaryWorkspace(
        project({ primaryWorkspace: { ...saved, authorityFingerprint: '  ' } }),
        [row]
      )
    ).toBeUndefined()
    expect(
      resolveProjectPrimaryWorkspace(project({ primaryWorkspace: saved }), [
        { ...row, instanceId: undefined }
      ])
    ).toBeUndefined()
    expect(
      resolveProjectPrimaryWorkspace(project({ primaryWorkspace: saved }), [
        { ...row, ownerHostId: 'ssh:other' }
      ])
    ).toBeUndefined()
  })

  it('requires a saved selection authority to agree with the project binding', () => {
    const saved = {
      instanceId: 'i',
      hostId: 'local',
      peerFingerprint: 'a',
      authorityFingerprint: 'authority',
      path: '/x',
      worktreeId: 'x'
    }
    const row = { id: 'x', path: '/x', instanceId: 'i', hostId: 'local', peerFingerprint: 'a' }

    expect(
      resolveProjectPrimaryWorkspace(
        project({ primaryWorkspace: saved, primaryAuthorityFingerprint: 'different-authority' }),
        [row]
      )
    ).toBeUndefined()
    expect(
      resolveProjectPrimaryWorkspace(
        project({ primaryWorkspace: saved, primaryAuthorityFingerprint: '  ' }),
        [row]
      )
    ).toBeUndefined()
    expect(
      resolveProjectPrimaryWorkspace(
        project({ primaryWorkspace: saved, primaryAuthorityFingerprint: 'authority' }),
        [row]
      )
    ).toBe(row)
  })

  it('rejects non-canonical owner host spellings', () => {
    const saved = {
      instanceId: 'i',
      hostId: 'ssh:%61',
      peerFingerprint: 'a',
      authorityFingerprint: 'authority',
      path: '/x',
      worktreeId: 'x'
    }
    const row = {
      id: 'x',
      path: '/x',
      instanceId: 'i',
      hostId: 'ssh:%61',
      peerFingerprint: 'a'
    }

    expect(resolveProjectPrimaryWorkspace(project({ primaryWorkspace: saved }), [row])).toBeUndefined()
  })
})
