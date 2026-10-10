import { describe, expect, it } from 'vitest'
import { getProjectPrimaryWorkspaceEligibility } from './project-primary-workspace-eligibility'

const folder = {
  id: 'folder',
  path: '/project',
  displayName: 'Project',
  badgeColor: '#000',
  addedAt: 1,
  kind: 'folder' as const
}
const root = {
  id: 'folder::/project',
  repoId: 'folder',
  projectId: 'p',
  hostId: 'local' as const,
  instanceId: 'i',
  peerFingerprint: 'peer',
  path: '/project',
  displayName: 'Project',
  isMainWorktree: true,
  isArchived: false,
  isBare: false,
  prunable: false
}

describe('project primary workspace eligibility', () => {
  it('allows registered folder project roots and rejects unrelated folder contexts', () => {
    expect(getProjectPrimaryWorkspaceEligibility(root as never, folder)).toBeUndefined()
    expect(
      getProjectPrimaryWorkspaceEligibility({ ...root, path: '/nested' } as never, folder)
    ).toContain('registered project folder')
  })

  it('rejects unusable identity and repository states', () => {
    expect(
      getProjectPrimaryWorkspaceEligibility(
        { ...root, peerFingerprint: undefined } as never,
        folder
      )
    ).toContain('owner identity')
    expect(
      getProjectPrimaryWorkspaceEligibility({ ...root, isArchived: true } as never, folder)
    ).toContain('Archived')
  })
})
