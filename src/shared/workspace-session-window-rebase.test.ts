import { describe, expect, it } from 'vitest'
import {
  partitionWorkspaceSessionByWorktrees,
  rebaseWorkspaceSessionWrite
} from './workspace-session-window-rebase'
import { getDefaultWorkspaceSession } from './constants'
import type { Tab } from './tab-types'
import type { TerminalTab } from './terminal-tab-types'
import type { WorkspaceSessionState } from './workspace-session-state-types'
import { worktreeWorkspaceKey } from './workspace-scope'

const PROJECT_WT = 'project-wt'
const OTHER_WT = 'other-wt'
const PROJECT_WINDOW = new Set([PROJECT_WT])

function makeTab(id: string, worktreeId: string): TerminalTab {
  return {
    id,
    ptyId: null,
    worktreeId,
    title: id,
    customTitle: null,
    color: null,
    sortOrder: 0,
    createdAt: 1
  }
}

function makeUnifiedTab(id: string, worktreeId: string): Tab {
  return {
    id,
    entityId: id,
    groupId: `group-${worktreeId}`,
    worktreeId,
    contentType: 'terminal',
    label: id,
    customLabel: null,
    color: null,
    sortOrder: 0,
    createdAt: 1
  }
}

function session(overrides: Partial<WorkspaceSessionState>): WorkspaceSessionState {
  return { ...getDefaultWorkspaceSession(), ...overrides }
}

describe('rebaseWorkspaceSessionWrite', () => {
  it('keeps the other window tabs when a project window writes only its own', () => {
    const current = session({
      tabsByWorktree: {
        [PROJECT_WT]: [makeTab('t-project', PROJECT_WT)],
        [OTHER_WT]: [makeTab('t-other', OTHER_WT)]
      }
    })
    // The project window read and wrote only its own worktree.
    const incoming = session({
      tabsByWorktree: {
        [PROJECT_WT]: [makeTab('t-project', PROJECT_WT), makeTab('t-new', PROJECT_WT)]
      }
    })

    const next = rebaseWorkspaceSessionWrite(current, incoming, PROJECT_WINDOW)

    expect(next.tabsByWorktree[PROJECT_WT]).toHaveLength(2)
    expect(next.tabsByWorktree[OTHER_WT]).toEqual([makeTab('t-other', OTHER_WT)])
  })

  it('lets the project window delete its own tabs', () => {
    const current = session({
      tabsByWorktree: { [PROJECT_WT]: [makeTab('t-project', PROJECT_WT)], [OTHER_WT]: [] }
    })
    const next = rebaseWorkspaceSessionWrite(
      current,
      session({ tabsByWorktree: {} }),
      PROJECT_WINDOW
    )

    expect(next.tabsByWorktree[PROJECT_WT]).toBeUndefined()
    expect(next.tabsByWorktree[OTHER_WT]).toEqual([])
  })

  it('never lets a stale read overwrite a key the window does not own', () => {
    const current = session({
      tabsByWorktree: { [OTHER_WT]: [makeTab('t-other-new', OTHER_WT)] }
    })
    // The project window still holds the pre-change value for a worktree that is not its own.
    const incoming = session({
      tabsByWorktree: { [OTHER_WT]: [makeTab('t-other-stale', OTHER_WT)] }
    })

    const next = rebaseWorkspaceSessionWrite(current, incoming, PROJECT_WINDOW)

    expect(next.tabsByWorktree[OTHER_WT]).toEqual([makeTab('t-other-new', OTHER_WT)])
  })

  it('routes tab-keyed fields through the tab owning worktree', () => {
    const layout = {
      root: { type: 'leaf' as const, leafId: 'l' },
      activeLeafId: 'l',
      expandedLeafId: null
    }
    const current = session({
      tabsByWorktree: {
        [PROJECT_WT]: [makeTab('t-project', PROJECT_WT)],
        [OTHER_WT]: [makeTab('t-other', OTHER_WT)]
      },
      terminalLayoutsByTabId: { 't-project': layout, 't-other': layout }
    })
    const incoming = session({
      tabsByWorktree: { [PROJECT_WT]: [makeTab('t-project', PROJECT_WT)] },
      terminalLayoutsByTabId: {}
    })

    const next = rebaseWorkspaceSessionWrite(current, incoming, PROJECT_WINDOW)

    // The project window dropped its own layout; the other window's survives.
    expect(next.terminalLayoutsByTabId['t-project']).toBeUndefined()
    expect(next.terminalLayoutsByTabId['t-other']).toEqual(layout)
  })

  it('routes pane-keyed fields through the tab id embedded in the pane key', () => {
    const current = session({
      unifiedTabs: {
        [PROJECT_WT]: [makeUnifiedTab('t-project', PROJECT_WT)],
        [OTHER_WT]: [makeUnifiedTab('t-other', OTHER_WT)]
      },
      terminalPtyIncarnationsByPaneKey: { 't-project:1': 'inc-3', 't-other:1': 'inc-7' }
    })
    const incoming = session({
      unifiedTabs: { [PROJECT_WT]: [makeUnifiedTab('t-project', PROJECT_WT)] },
      terminalPtyIncarnationsByPaneKey: { 't-project:1': 'inc-4' }
    })

    const next = rebaseWorkspaceSessionWrite(current, incoming, PROJECT_WINDOW)

    expect(next.terminalPtyIncarnationsByPaneKey).toEqual({
      't-project:1': 'inc-4',
      't-other:1': 'inc-7'
    })
  })

  it('leaves global focus fields to the shared writer', () => {
    const current = session({ activeWorktreeId: OTHER_WT, activeTabId: 't-other' })
    const incoming = session({ activeWorktreeId: PROJECT_WT, activeTabId: 't-project' })

    const next = rebaseWorkspaceSessionWrite(current, incoming, PROJECT_WINDOW)

    expect(next.activeWorktreeId).toBe(OTHER_WT)
    expect(next.activeTabId).toBe('t-other')
  })

  it('partitions the shutdown worktree array by owner', () => {
    const current = session({ activeWorktreeIdsOnShutdown: [PROJECT_WT, OTHER_WT] })
    const incoming = session({ activeWorktreeIdsOnShutdown: [] })

    const next = rebaseWorkspaceSessionWrite(current, incoming, PROJECT_WINDOW)

    expect(next.activeWorktreeIdsOnShutdown).toEqual([OTHER_WT])
  })

  it('is the pre-window behavior when no ownership is declared', () => {
    const current = session({ tabsByWorktree: { [OTHER_WT]: [makeTab('t-other', OTHER_WT)] } })
    const incoming = session({
      tabsByWorktree: { [PROJECT_WT]: [makeTab('t-project', PROJECT_WT)] }
    })

    expect(rebaseWorkspaceSessionWrite(current, incoming, new Set())).toBe(incoming)
  })

  it('survives two windows writing in alternation without losing tabs', () => {
    // The regression that matters: interleaved writes must converge, not clobber.
    let stored = session({
      tabsByWorktree: {
        [PROJECT_WT]: [makeTab('p1', PROJECT_WT)],
        [OTHER_WT]: [makeTab('o1', OTHER_WT)]
      }
    })
    const projectView = { [PROJECT_WT]: [makeTab('p1', PROJECT_WT)] }
    const sharedView = { [OTHER_WT]: [makeTab('o1', OTHER_WT)] }

    stored = rebaseWorkspaceSessionWrite(
      stored,
      session({
        tabsByWorktree: {
          ...projectView,
          [PROJECT_WT]: [makeTab('p1', PROJECT_WT), makeTab('p2', PROJECT_WT)]
        }
      }),
      PROJECT_WINDOW
    )
    stored = rebaseWorkspaceSessionWrite(
      stored,
      session({
        tabsByWorktree: {
          ...sharedView,
          [OTHER_WT]: [makeTab('o1', OTHER_WT), makeTab('o2', OTHER_WT)]
        }
      }),
      new Set([OTHER_WT])
    )

    expect(stored.tabsByWorktree[PROJECT_WT].map((tab) => tab.id)).toEqual(['p1', 'p2'])
    expect(stored.tabsByWorktree[OTHER_WT].map((tab) => tab.id)).toEqual(['o1', 'o2'])
  })

  it('sends the active focus to whichever window serves the workspace it names', () => {
    const current = session({
      activeWorktreeId: PROJECT_WT,
      activeWorkspaceKey: worktreeWorkspaceKey(PROJECT_WT),
      activeRepoId: 'repo-project',
      activeTabId: 't-project',
      tabsByWorktree: { [PROJECT_WT]: [makeTab('t-project', PROJECT_WT)] }
    })

    const split = partitionWorkspaceSessionByWorktrees(current, PROJECT_WINDOW)

    // Why it must follow: the project window would otherwise hydrate its tabs with nothing selected.
    expect(split.owned.activeWorktreeId).toBe(PROJECT_WT)
    expect(split.owned.activeTabId).toBe('t-project')
    expect(split.rest.activeWorktreeId).toBeNull()
    expect(split.rest.activeTabId).toBeNull()
  })

  it('leaves the focus with the free window when it names a workspace that window serves', () => {
    const current = session({
      activeWorktreeId: OTHER_WT,
      activeWorkspaceKey: worktreeWorkspaceKey(OTHER_WT),
      activeTabId: 't-other',
      tabsByWorktree: { [OTHER_WT]: [makeTab('t-other', OTHER_WT)] }
    })

    const split = partitionWorkspaceSessionByWorktrees(current, PROJECT_WINDOW)

    expect(split.owned.activeWorktreeId).toBeNull()
    expect(split.rest.activeWorktreeId).toBe(OTHER_WT)
    expect(split.rest.activeTabId).toBe('t-other')
  })
})
