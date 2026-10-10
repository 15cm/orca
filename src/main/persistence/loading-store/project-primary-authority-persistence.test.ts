import { describe, expect, it, vi } from 'vitest'
import type { Project } from '../../../shared/project-types'
import { ProjectPrimaryAuthorityPersistence } from './project-primary-authority-persistence'

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project-a',
    displayName: 'Project A',
    badgeColor: '#123456',
    sourceRepoIds: ['repo-a'],
    createdAt: 1,
    updatedAt: 2,
    primaryAuthorityFingerprint: 'desktop-a',
    ...overrides
  }
}

function choice(
  overrides: Record<string, unknown> = {}
): NonNullable<Project['primaryWorkspace']> {
  return {
    worktreeId: 'repo-a::/worktree',
    instanceId: 'instance-a',
    hostId: 'local',
    path: '/worktree',
    peerFingerprint: 'owner-a',
    authorityFingerprint: 'desktop-a',
    ...overrides
  } as NonNullable<Project['primaryWorkspace']>
}

function createPersistence(
  current: Project,
  flush: () => Promise<void> = vi.fn().mockResolvedValue(undefined),
  freezeWrites = vi.fn()
) {
  let writable = true
  const scheduleSave = vi.fn()
  const persistence = new ProjectPrimaryAuthorityPersistence({
    projects: () => [current],
    isWritable: () => writable,
    flush,
    scheduleSave,
    freezeWrites: () => {
      writable = false
      freezeWrites()
    },
    setPrimaryWorkspace: (id, primary) => {
      const found = id === current.id ? current : null
      if (found) {
        found.primaryWorkspace = primary
        found.primaryWorkspaceRevision = (found.primaryWorkspaceRevision ?? 0) + 1
        found.updatedAt += 1
      }
      return found
    }
  })
  return { persistence, scheduleSave, freezeWrites }
}

function snapshot(
  primaryWorkspace: Project['primaryWorkspace'] | undefined,
  revision = 3,
  overrides: Record<string, unknown> = {}
) {
  return {
    projectId: 'project-a',
    fingerprint: 'desktop-a',
    primaryWorkspace,
    revision,
    ...overrides
  }
}

describe('ProjectPrimaryAuthorityPersistence', () => {
  it('rejects malformed existing bindings and saved choices from another authority', async () => {
    for (const malformedBinding of [undefined, null, '', '   ', 7]) {
      const current = project({ primaryAuthorityFingerprint: malformedBinding as never })
      const { persistence } = createPersistence(current)
      await expect(persistence.bind(current.id, 'desktop-a')).rejects.toThrow(
        'malformed_primary_authority_binding'
      )
    }

    const current = project({
      primaryWorkspace: choice({ authorityFingerprint: 'desktop-b' }) as never
    })
    delete current.primaryAuthorityFingerprint
    const { persistence } = createPersistence(current)
    await expect(persistence.bind(current.id, 'desktop-a')).rejects.toThrow(
      'primary_authority_conflict'
    )
    expect(current.primaryAuthorityFingerprint).toBeUndefined()
  })

  it('rejects blank authority fingerprints before mutating or saving', async () => {
    const current = project()
    const flush = vi.fn().mockResolvedValue(undefined)
    const { persistence } = createPersistence(current, flush)

    await expect(persistence.bind(current.id, '  ')).rejects.toThrow(
      'invalid_primary_authority_fingerprint'
    )
    await expect(
      persistence.applySnapshot(snapshot(choice(), 3, { fingerprint: '  ' }))
    ).rejects.toThrow('invalid_primary_authority_fingerprint')

    expect(current.primaryWorkspaceRevision).toBeUndefined()
    expect(flush).not.toHaveBeenCalled()
  })

  it('reattaches a matching independent authority when primary choice is the null sentinel', async () => {
    const current = project({ primaryWorkspace: null as never })
    const flush = vi.fn().mockResolvedValue(undefined)
    const { persistence } = createPersistence(current, flush)

    await expect(persistence.bind(current.id, 'desktop-a')).resolves.toMatchObject({
      primaryAuthorityFingerprint: 'desktop-a',
      primaryWorkspace: null
    })
    expect(flush).not.toHaveBeenCalled()
    await persistence.applySnapshot(snapshot(choice({ path: '/reassigned' }), 3))
    expect(current.primaryWorkspace?.path).toBe('/reassigned')
    expect(current.primaryWorkspaceRevision).toBe(3)
    expect(flush).toHaveBeenCalledOnce()
  })

  it('keeps a bound malformed saved value untouched until an explicit valid snapshot', async () => {
    const malformed = { raw: 'unavailable' }
    const current = project({ primaryWorkspace: malformed as never })
    const { persistence } = createPersistence(current)

    await persistence.bind(current.id, 'desktop-a')
    expect(current.primaryWorkspace).toBe(malformed)
    await persistence.applySnapshot(snapshot(choice({ path: '/explicit-reassignment' }), 3))
    expect(current.primaryWorkspace?.path).toBe('/explicit-reassignment')
  })

  it('does not bind an unbound null sentinel by adopting a new desktop authority', async () => {
    const current = project({ primaryWorkspace: null as never })
    delete current.primaryAuthorityFingerprint
    const { persistence } = createPersistence(current)

    await expect(persistence.bind(current.id, 'desktop-a')).rejects.toThrow(
      'primary_authority_conflict'
    )
    expect(Object.hasOwn(current, 'primaryWorkspace')).toBe(true)
    expect(current.primaryWorkspace).toBeNull()
    expect(Object.hasOwn(current, 'primaryAuthorityFingerprint')).toBe(false)
  })

  it('restores an exact saved null and revision after snapshot write failure', async () => {
    const original = project({ primaryWorkspace: null as never, primaryWorkspaceRevision: 2 })
    const updatedAt = original.updatedAt
    const flush = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('write failed'))
      .mockResolvedValueOnce(undefined)
    const { persistence } = createPersistence(original, flush)

    await expect(persistence.applySnapshot(snapshot(choice()))).rejects.toThrow('write failed')

    expect(Object.hasOwn(original, 'primaryWorkspace')).toBe(true)
    expect(original.primaryWorkspace).toBeNull()
    expect(original.primaryWorkspaceRevision).toBe(2)
    expect(original.updatedAt).toBe(updatedAt)
    expect(flush).toHaveBeenCalledTimes(2)
  })

  it('preserves the explicit unavailable snapshot sentinel as a present null value', async () => {
    const current = project({ primaryWorkspace: choice(), primaryWorkspaceRevision: 2 })
    const { persistence } = createPersistence(current)

    await persistence.applySnapshot(snapshot(null as never, 3))

    expect(Object.hasOwn(current, 'primaryWorkspace')).toBe(true)
    expect(current.primaryWorkspace).toBeNull()
    expect(current.primaryWorkspaceRevision).toBe(3)
  })

  it('restores the exact malformed saved value by reference after write failure', async () => {
    const malformed = { savedRawValue: ['keep', null] }
    const current = project({ primaryWorkspace: malformed as never, primaryWorkspaceRevision: 2 })
    const flush = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('write failed'))
      .mockResolvedValueOnce(undefined)
    const { persistence } = createPersistence(current, flush)

    await expect(persistence.applySnapshot(snapshot(choice(), 3))).rejects.toThrow('write failed')

    expect(Object.hasOwn(current, 'primaryWorkspace')).toBe(true)
    expect(current.primaryWorkspace).toBe(malformed)
  })

  it('serializes concurrent revisions and lets a later snapshot proceed after rollback', async () => {
    const original = project({ primaryWorkspace: choice({ path: '/v2' }), primaryWorkspaceRevision: 2 })
    const flush = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('first write failed'))
      .mockResolvedValue(undefined)
    const { persistence } = createPersistence(original, flush)
    const earlier = persistence.applySnapshot(snapshot(choice({ path: '/v3' }), 3))
    const later = persistence.applySnapshot(snapshot(choice({ path: '/v4' }), 4))

    const [earlierResult, laterResult] = await Promise.allSettled([earlier, later])

    expect(earlierResult.status).toBe('rejected')
    expect(laterResult.status).toBe('fulfilled')
    expect(original.primaryWorkspace?.path).toBe('/v4')
    expect(original.primaryWorkspaceRevision).toBe(4)
    expect(flush).toHaveBeenCalledTimes(3)
  })

  it('rejects malformed current and incoming revisions without resetting current state', async () => {
    const current = project({ primaryWorkspace: choice(), primaryWorkspaceRevision: null as never })
    const flush = vi.fn().mockResolvedValue(undefined)
    const { persistence } = createPersistence(current, flush)

    for (const malformedRevision of [null, '4', Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      current.primaryWorkspaceRevision = malformedRevision as never
      await expect(persistence.applySnapshot(snapshot(choice(), 4))).rejects.toThrow(
        'malformed_primary_authority_revision'
      )
      expect(current.primaryWorkspaceRevision).toBe(malformedRevision)
    }

    current.primaryWorkspaceRevision = 2
    for (const malformedRevision of ['4', Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(persistence.applySnapshot(snapshot(choice(), malformedRevision as never))).rejects.toThrow(
        'malformed_primary_authority_revision'
      )
    }
    expect(current.primaryWorkspaceRevision).toBe(2)
    expect(flush).not.toHaveBeenCalled()
  })

  it('rejects snapshots with mismatched choice authority or invalid owner identity', async () => {
    const current = project({ primaryWorkspace: choice(), primaryWorkspaceRevision: 2 })
    const { persistence } = createPersistence(current)

    for (const invalid of [
      choice({ authorityFingerprint: 'desktop-b' }),
      choice({ hostId: 'runtime:paired-runtime' }),
      choice({ hostId: 'ssh:%6fwner-a' }),
      choice({ instanceId: '  ' }),
      choice({ peerFingerprint: '' }),
      choice({ path: '' })
    ]) {
      await expect(
        persistence.applySnapshot(snapshot(invalid as never, 3))
      ).rejects.toThrow('invalid_primary_authority_snapshot')
    }

    await persistence.applySnapshot(snapshot(choice({ hostId: 'ssh:owner-a' }), 3))
    expect(current.primaryWorkspace?.hostId).toBe('ssh:owner-a')
    expect(current.primaryWorkspace?.path).toBe('/worktree')
    expect(current.primaryWorkspaceRevision).toBe(3)
  })

  it('preserves raw prior state and freezes writes if rollback persistence also fails', async () => {
    const original = project({ primaryWorkspace: null as never, primaryWorkspaceRevision: 2 })
    const flush = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('write failed'))
      .mockRejectedValueOnce(new Error('rollback failed'))
    const { persistence, freezeWrites } = createPersistence(original, flush)

    await expect(persistence.applySnapshot(snapshot(choice()))).rejects.toThrow(
      'primary_authority_snapshot_persistence_failed_closed'
    )

    expect(Object.hasOwn(original, 'primaryWorkspace')).toBe(true)
    expect(original.primaryWorkspace).toBeNull()
    expect(original.primaryWorkspaceRevision).toBe(2)
    expect(persistence.isAvailable).toBe(false)
    expect(freezeWrites).toHaveBeenCalledOnce()
  })
})
