import { describe, expect, it } from 'vitest'
import type { Worktree } from '../../../../shared/worktree/types'
import { isPrimaryWorkspaceRow } from './worktree-card-presentation'

const selected: Worktree = {
  id: 'shared',
  repoId: 'repo',
  path: '/selected',
  head: 'abc',
  branch: 'refs/heads/main',
  isBare: false,
  isMainWorktree: false,
  displayName: 'selected',
  comment: '',
  linkedIssue: null,
  linkedPR: null,
  linkedLinearIssue: null,
  isArchived: false,
  isUnread: false,
  isPinned: false,
  sortOrder: 0,
  lastActivityAt: 0,
  hostId: 'local',
  ownerHostId: 'local',
  instanceId: 'instance',
  peerFingerprint: 'selected-peer'
}

describe('primary workspace card presentation identity', () => {
  it('marks only row owned by selected authenticated peer', () => {
    const duplicatePeer = { ...selected, path: '/other', peerFingerprint: 'other-peer' }

    expect(isPrimaryWorkspaceRow(selected, selected)).toBe(true)
    expect(isPrimaryWorkspaceRow(selected, duplicatePeer)).toBe(false)
  })
})
