import { describe, expect, it } from 'vitest'
import {
  computeWindowOwnershipPrioritySeed,
  diffPtyOwnerWindows,
  type PublishedLeaf,
  type PublishedWindowGraph,
  type WindowOwnershipPriorityInput
} from './window-pty-ownership-priority'

const FREE_WINDOW = 1
const PERC_WINDOW = 2
const PERC_GROUP = 'group-perc'
const BANK_GROUP = 'group-bank'

const PERC_WORKTREE = 'perc-repo::/tmp/perc/main'
const BANK_WORKTREE = 'bank-repo::/tmp/bank/main'
const PERC_FOLDER_WORKSPACE = 'folder:perc-tasks'
const ORPHAN_WORKTREE = 'orphan-repo::/tmp/orphan'

const worktreeGroups = new Map<string, string | null>([
  [PERC_WORKTREE, PERC_GROUP],
  [BANK_WORKTREE, BANK_GROUP],
  [PERC_FOLDER_WORKSPACE, PERC_GROUP],
  [ORPHAN_WORKTREE, null]
])

const tabs = new Map<string, string>([
  ['tab-perc', PERC_WORKTREE],
  ['tab-bank', BANK_WORKTREE],
  ['tab-folder', PERC_FOLDER_WORKSPACE],
  ['tab-orphan', ORPHAN_WORKTREE]
])

const leaves = new Map<string, PublishedLeaf>([
  ['tab-perc::pane:1', { ptyId: 'pty-perc', worktreeId: PERC_WORKTREE }],
  ['tab-bank::pane:1', { ptyId: 'pty-bank', worktreeId: BANK_WORKTREE }],
  ['tab-folder::pane:1', { ptyId: 'pty-folder', worktreeId: PERC_FOLDER_WORKSPACE }],
  ['tab-orphan::pane:1', { ptyId: 'pty-orphan', worktreeId: ORPHAN_WORKTREE }]
])

function publication(...leafKeys: string[]): PublishedWindowGraph {
  return {
    tabIds: new Set(leafKeys.map((key) => key.split('::')[0]!)),
    leafKeys: new Set(leafKeys)
  }
}

/** Both windows publish everything; the free window published first. */
function everythingInBothWindows(): Map<number, PublishedWindowGraph> {
  const all = publication(...leaves.keys())
  return new Map([
    [FREE_WINDOW, all],
    [PERC_WINDOW, all]
  ])
}

function input(
  overrides: Partial<WindowOwnershipPriorityInput> = {}
): WindowOwnershipPriorityInput {
  return {
    publications: everythingInBothWindows(),
    explicitPtyClaims: new Map(),
    resolveWindowProjectGroupId: (windowId) => (windowId === PERC_WINDOW ? PERC_GROUP : null),
    resolveWorktreeProjectGroupId: (worktreeId) => worktreeGroups.get(worktreeId) ?? null,
    getTabWorktreeId: (tabId) => tabs.get(tabId),
    getLeaf: (leafKey) => leaves.get(leafKey),
    ...overrides
  }
}

describe('computeWindowOwnershipPrioritySeed', () => {
  it('lets the project window claim its own worktrees over the window that published first', () => {
    const seed = computeWindowOwnershipPrioritySeed(input())

    expect(seed.ptyOwners.get('pty-perc')).toBe(PERC_WINDOW)
    expect(seed.leafOwners.get('tab-perc::pane:1')).toBe(PERC_WINDOW)
    expect(seed.tabOwners.get('tab-perc')).toBe(PERC_WINDOW)
  })

  it('claims folder workspaces of the group, not only git worktrees', () => {
    const seed = computeWindowOwnershipPrioritySeed(input())

    expect(seed.ptyOwners.get('pty-folder')).toBe(PERC_WINDOW)
    expect(seed.tabOwners.get('tab-folder')).toBe(PERC_WINDOW)
  })

  it('leaves other groups and unresolvable worktrees to arrival order', () => {
    const seed = computeWindowOwnershipPrioritySeed(input())

    expect(seed.ptyOwners.has('pty-bank')).toBe(false)
    expect(seed.ptyOwners.has('pty-orphan')).toBe(false)
    expect(seed.tabOwners.has('tab-orphan')).toBe(false)
  })

  it('seeds nothing when no window carries a scope (flag off or all free)', () => {
    const seed = computeWindowOwnershipPrioritySeed(
      input({ resolveWindowProjectGroupId: () => null })
    )

    expect(seed.ptyOwners.size).toBe(0)
    expect(seed.leafOwners.size).toBe(0)
    expect(seed.tabOwners.size).toBe(0)
  })

  it('only lets a scoped window claim what it actually publishes', () => {
    const seed = computeWindowOwnershipPrioritySeed(
      input({
        publications: new Map([
          [FREE_WINDOW, publication(...leaves.keys())],
          [PERC_WINDOW, publication('tab-folder::pane:1')]
        ])
      })
    )

    expect(seed.ptyOwners.get('pty-folder')).toBe(PERC_WINDOW)
    expect(seed.ptyOwners.has('pty-perc')).toBe(false)
  })

  it('ranks an explicit claim above project scope', () => {
    const seed = computeWindowOwnershipPrioritySeed(
      input({ explicitPtyClaims: new Map([['pty-perc', FREE_WINDOW]]) })
    )

    expect(seed.ptyOwners.get('pty-perc')).toBe(FREE_WINDOW)
  })

  it('ignores a claim whose window does not publish the PTY, without dropping it', () => {
    const claims = new Map([['pty-bank', PERC_WINDOW]])
    const seed = computeWindowOwnershipPrioritySeed(
      input({
        publications: new Map([
          [FREE_WINDOW, publication(...leaves.keys())],
          [PERC_WINDOW, publication('tab-perc::pane:1')]
        ]),
        explicitPtyClaims: claims
      })
    )

    expect(seed.ptyOwners.has('pty-bank')).toBe(false)
    expect(claims.has('pty-bank')).toBe(true)
  })
})

describe('diffPtyOwnerWindows', () => {
  it('reports moves, first owners and dropped owners only', () => {
    const changes = diffPtyOwnerWindows(
      new Map([
        ['moved', 1],
        ['same', 1],
        ['gone', 2]
      ]),
      new Map([
        ['moved', 2],
        ['same', 1],
        ['fresh', 2]
      ])
    )

    expect(changes).toEqual([
      { ptyId: 'moved', previousWindowId: 1, nextWindowId: 2 },
      { ptyId: 'fresh', previousWindowId: null, nextWindowId: 2 },
      { ptyId: 'gone', previousWindowId: 2, nextWindowId: null }
    ])
  })
})
