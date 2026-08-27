import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  _resetPtyWindowOwnershipForTests,
  applyPtyWindowOwnership,
  getForeignPtyOwnerWindow,
  hydratePtyWindowOwnership,
  onPtyBecameOwnedByThisWindow,
  onPtyWindowOwnershipChange
} from './pty-window-ownership-state'

const PERC = { projectGroupId: 'group-perc' }
const FREE = { projectGroupId: null }

beforeEach(() => {
  _resetPtyWindowOwnershipForTests()
})

describe('pty-window-ownership-state', () => {
  it('exposes the foreign owner of a mirrored pane and nothing for our own', () => {
    applyPtyWindowOwnership([
      { ptyId: 'mine', ownedByThisWindow: true, owner: FREE },
      { ptyId: 'theirs', ownedByThisWindow: false, owner: PERC },
      { ptyId: 'nobody', ownedByThisWindow: false, owner: null }
    ])

    expect(getForeignPtyOwnerWindow('mine')).toBeNull()
    expect(getForeignPtyOwnerWindow('theirs')).toEqual(PERC)
    expect(getForeignPtyOwnerWindow('nobody')).toBeNull()
    expect(getForeignPtyOwnerWindow('unknown')).toBeNull()
  })

  it('fires the became-owner hook only on a foreign → ours transition', () => {
    const becameOwner = vi.fn()
    onPtyBecameOwnedByThisWindow(becameOwner)

    applyPtyWindowOwnership([{ ptyId: 'p', ownedByThisWindow: true, owner: FREE }])
    expect(becameOwner).not.toHaveBeenCalled()

    applyPtyWindowOwnership([{ ptyId: 'p', ownedByThisWindow: true, owner: FREE }])
    expect(becameOwner).not.toHaveBeenCalled()

    applyPtyWindowOwnership([{ ptyId: 'p', ownedByThisWindow: false, owner: PERC }])
    applyPtyWindowOwnership([{ ptyId: 'p', ownedByThisWindow: true, owner: FREE }])
    expect(becameOwner).toHaveBeenCalledTimes(1)
    expect(becameOwner).toHaveBeenCalledWith('p')
  })

  it('never treats hydration as a transition, but ticks every affected pane', () => {
    const becameOwner = vi.fn()
    const changed = vi.fn()
    onPtyBecameOwnedByThisWindow(becameOwner)
    onPtyWindowOwnershipChange(changed)
    applyPtyWindowOwnership([{ ptyId: 'stale', ownedByThisWindow: false, owner: PERC }])
    changed.mockClear()

    hydratePtyWindowOwnership([{ ptyId: 'fresh', ownedByThisWindow: false, owner: PERC }])

    expect(becameOwner).not.toHaveBeenCalled()
    expect(getForeignPtyOwnerWindow('stale')).toBeNull()
    expect(getForeignPtyOwnerWindow('fresh')).toEqual(PERC)
    expect(changed.mock.calls.map(([event]) => event.ptyId).sort()).toEqual(['fresh', 'stale'])
  })
})
