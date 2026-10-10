import { describe, expect, it } from 'vitest'
import { mergeProjectCompatibilityProject } from './project-compatibility-core'
import type { Project, ProjectPrimaryWorkspace } from '../../../../shared/project-types'

const project = (overrides: Partial<Project> = {}): Project => ({
  id: 'p',
  displayName: 'P',
  badgeColor: '#000',
  sourceRepoIds: ['r'],
  createdAt: 1,
  updatedAt: 1,
  ...overrides
})

function savedPrimary(
  worktreeId: string,
  instanceId: string,
  path: string,
  authorityFingerprint = 'desktop-a',
  peerFingerprint = 'peer-a'
): ProjectPrimaryWorkspace {
  return {
    worktreeId,
    instanceId,
    hostId: 'local',
    path,
    authorityFingerprint,
    peerFingerprint
  }
}

describe('project primary compatibility merge', () => {
  it('keeps desktop selection when remote overlay omits it', () => {
    const primary = { worktreeId: 'r::/w', instanceId: 'i', hostId: 'local' as const, path: '/w' }
    expect(
      mergeProjectCompatibilityProject(
        project({ primaryWorkspace: primary, primaryWorkspaceRevision: 4 }),
        project()
      ).primaryWorkspace
    ).toEqual(primary)
  })

  it('rejects older remote selection revisions', () => {
    const current = {
      worktreeId: 'r::/new',
      instanceId: 'new',
      hostId: 'local' as const,
      path: '/new'
    }
    const old = { worktreeId: 'r::/old', instanceId: 'old', hostId: 'local' as const, path: '/old' }
    expect(
      mergeProjectCompatibilityProject(
        project({ primaryWorkspace: current, primaryWorkspaceRevision: 3 }),
        project({ primaryWorkspace: old, primaryWorkspaceRevision: 2 })
      ).primaryWorkspace
    ).toEqual(current)
  })

  it('preserves null choice, revision, and binding against a conflicting overlay', () => {
    const base = project({
      primaryWorkspace: null as never,
      primaryWorkspaceRevision: 8,
      primaryAuthorityFingerprint: 'desktop-a'
    })
    const overlay = project({
      displayName: 'Remote metadata',
      primaryWorkspace: savedPrimary('r::/remote', 'remote', '/remote', 'desktop-b', 'peer-b'),
      primaryWorkspaceRevision: 9,
      primaryAuthorityFingerprint: 'desktop-b'
    })

    const merged = mergeProjectCompatibilityProject(base, overlay)

    expect(merged.primaryWorkspace).toBeNull()
    expect(merged.primaryWorkspaceRevision).toBe(8)
    expect(merged.primaryAuthorityFingerprint).toBe('desktop-a')
    expect(merged.displayName).toBe('Remote metadata')
  })

  it('keeps current occupant when an overlay reassigns the same revision', () => {
    const current = savedPrimary('r::/current', 'current', '/current')
    const overlay = savedPrimary('r::/other', 'other', '/other')
    const merged = mergeProjectCompatibilityProject(
      project({
        primaryWorkspace: current,
        primaryWorkspaceRevision: 5,
        primaryAuthorityFingerprint: 'desktop-a'
      }),
      project({
        displayName: 'Merged metadata',
        primaryWorkspace: overlay,
        primaryWorkspaceRevision: 5,
        primaryAuthorityFingerprint: 'desktop-a'
      })
    )

    expect(merged.primaryWorkspace).toEqual(current)
    expect(merged.primaryWorkspaceRevision).toBe(5)
    expect(merged.displayName).toBe('Merged metadata')
  })

  it('preserves malformed current revision and selection against newer overlays', () => {
    const current = savedPrimary('r::/current', 'current', '/current')
    const merged = mergeProjectCompatibilityProject(
      project({
        primaryWorkspace: current,
        primaryWorkspaceRevision: 2.5,
        primaryAuthorityFingerprint: 'desktop-a'
      }),
      project({
        primaryWorkspace: savedPrimary('r::/other', 'other', '/other'),
        primaryWorkspaceRevision: 9,
        primaryAuthorityFingerprint: 'desktop-a'
      })
    )

    expect(merged.primaryWorkspace).toEqual(current)
    expect(merged.primaryWorkspaceRevision).toBe(2.5)
    expect(merged.primaryAuthorityFingerprint).toBe('desktop-a')
  })

  it('does not let foreign or incomplete peer identity erase desktop authority', () => {
    const current = savedPrimary('r::/current', 'current', '/current')
    const merged = mergeProjectCompatibilityProject(
      project({
        primaryWorkspace: current,
        primaryWorkspaceRevision: 3,
        primaryAuthorityFingerprint: 'desktop-a'
      }),
      project({
        displayName: 'Merged metadata',
        primaryWorkspace: {
          ...savedPrimary('r::/other', 'other', '/other', 'desktop-a'),
          peerFingerprint: undefined
        },
        primaryWorkspaceRevision: 4,
        primaryAuthorityFingerprint: 'desktop-a'
      })
    )

    expect(merged.primaryWorkspace).toEqual(current)
    expect(merged.primaryAuthorityFingerprint).toBe('desktop-a')
    expect(merged.displayName).toBe('Merged metadata')
  })
})
