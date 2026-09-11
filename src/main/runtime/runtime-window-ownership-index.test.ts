import { describe, expect, it } from 'vitest'
import { folderWorkspaceKey } from '../../shared/workspace-scope'
import { rebuildRuntimeWindowOwnershipIndex } from './runtime-window-ownership-index'

describe('rebuildRuntimeWindowOwnershipIndex', () => {
  const makeInput = (overrides: Record<string, unknown> = {}) => ({
    publications: new Map(),
    explicitClaims: new Map(),
    transientClaims: new Map(),
    previousPtyOwners: new Map(),
    tabs: new Map(),
    leaves: new Map(),
    store: null,
    resolveWindowProjectGroupId: () => null,
    ...overrides
  })

  it('returns transient claims consumed by graph adoption', () => {
    const ptyId = 'pty-adopted'
    const leafKey = 'tab::leaf'
    const index = rebuildRuntimeWindowOwnershipIndex(
      makeInput({
        publications: new Map([
          [1, { tabIds: new Set(['tab']), leafKeys: new Set([leafKey]), browserPageIds: new Set() }]
        ]),
        transientClaims: new Map([[ptyId, 1]]),
        leaves: new Map([[leafKey, { ptyId, worktreeId: 'repo::/worktree' }]])
      })
    )

    expect(index.ptyOwners.get(ptyId)).toBe(1)
    expect(index.consumedTransientPtyIds).toEqual(new Set([ptyId]))
  })

  it('does not consume a headless transient claim before publication', () => {
    const ptyId = 'pty-headless'
    const index = rebuildRuntimeWindowOwnershipIndex(
      makeInput({ transientClaims: new Map([[ptyId, -1]]) })
    )

    expect(index.ptyOwners.get(ptyId)).toBe(-1)
    expect(index.consumedTransientPtyIds).toEqual(new Set())
  })

  it('keeps a moved PTY owned by its publisher after the old publisher closes', () => {
    const ptyId = 'pty-moved'
    const leafKey = 'tab::leaf'
    const publication = (windowId: number) =>
      [
        windowId,
        { tabIds: new Set(['tab']), leafKeys: new Set([leafKey]), browserPageIds: new Set() }
      ] as const
    const base = {
      leaves: new Map([[leafKey, { ptyId, worktreeId: 'repo::/worktree' }]])
    }
    const adopted = rebuildRuntimeWindowOwnershipIndex(
      makeInput({
        ...base,
        publications: new Map([publication(1)]),
        transientClaims: new Map([[ptyId, 1]])
      })
    )
    expect(adopted.consumedTransientPtyIds).toEqual(new Set([ptyId]))

    const moved = rebuildRuntimeWindowOwnershipIndex(
      makeInput({
        ...base,
        publications: new Map([publication(2)]),
        explicitClaims: new Map([[ptyId, 2]]),
        previousPtyOwners: adopted.ptyOwners
      })
    )
    expect(moved.ptyOwners.get(ptyId)).toBe(2)
    const afterClose = rebuildRuntimeWindowOwnershipIndex(
      makeInput({ previousPtyOwners: moved.ptyOwners })
    )
    expect(afterClose.ptyOwners.has(ptyId)).toBe(false)
  })

  it('resolves folder workspaces from their canonical workspace key', () => {
    const folderId = 'folder-workspace-1'
    const ptyId = 'pty-folder'
    const leafKey = 'tab-folder::leaf-1'
    const index = rebuildRuntimeWindowOwnershipIndex({
      publications: new Map([
        [
          1,
          {
            tabIds: new Set(['tab-folder']),
            leafKeys: new Set([leafKey]),
            browserPageIds: new Set()
          }
        ],
        [
          2,
          {
            tabIds: new Set(['tab-folder']),
            leafKeys: new Set([leafKey]),
            browserPageIds: new Set()
          }
        ]
      ]),
      explicitClaims: new Map(),
      transientClaims: new Map(),
      previousPtyOwners: new Map(),
      tabs: new Map([['tab-folder', { worktreeId: folderWorkspaceKey(folderId) }]]),
      leaves: new Map([[leafKey, { ptyId, worktreeId: folderWorkspaceKey(folderId) }]]),
      store: { getFolderWorkspaces: () => [{ id: folderId, projectGroupId: 'group-1' }] },
      resolveWindowProjectGroupId: (windowId) => (windowId === 2 ? 'group-1' : null)
    })

    expect(index.ptyOwners.get(ptyId)).toBe(2)
    expect(index.tabOwners.get('tab-folder')).toBe(2)
  })

  it('suppresses exited PTYs even while stale graph leaves remain published', () => {
    const ptyId = 'pty-exited'
    const leafKey = 'tab::leaf'
    const index = rebuildRuntimeWindowOwnershipIndex({
      publications: new Map([
        [1, { tabIds: new Set(['tab']), leafKeys: new Set([leafKey]), browserPageIds: new Set() }]
      ]),
      explicitClaims: new Map([[ptyId, 1]]),
      transientClaims: new Map([[ptyId, 1]]),
      suppressedPtyIds: new Set([ptyId]),
      previousPtyOwners: new Map([[ptyId, 1]]),
      tabs: new Map([['tab', { worktreeId: 'repo::/worktree' }]]),
      leaves: new Map([[leafKey, { ptyId, worktreeId: 'repo::/worktree' }]]),
      store: null,
      resolveWindowProjectGroupId: () => null
    })

    expect(index.ptyOwners.has(ptyId)).toBe(false)
  })
})
