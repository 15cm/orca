import { describe, expect, it } from 'vitest'
import { withProjectWindowFocus } from './project-window-session-focus'
import { getDefaultWorkspaceSession } from '../../shared/constants'
import type { TerminalTab } from '../../shared/terminal-tab-types'
import type { WorkspaceSessionState } from '../../shared/workspace-session-state-types'

const TASKS = 'folder:tasks'
const TERMINALS = 'folder:terminals'
const WORKTREE = 'repo-a::/wt/main'

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

/** The `owned` half of the partition: keys of the project, focus fields explicitly cleared. */
function session(overrides: Partial<WorkspaceSessionState>): WorkspaceSessionState {
  return {
    ...getDefaultWorkspaceSession(),
    activeWorktreeId: null,
    activeWorkspaceKey: null,
    activeRepoId: null,
    activeTabId: null,
    ...overrides
  }
}

describe('withProjectWindowFocus', () => {
  it('opens on the most recently visited workspace of the project', () => {
    const read = session({
      tabsByWorktree: {
        [TASKS]: [makeTab('t-tasks', TASKS)],
        [TERMINALS]: [makeTab('t-terminals', TERMINALS)]
      },
      lastVisitedAtByWorktreeId: { [TASKS]: 2_000, [TERMINALS]: 1_000 },
      activeTabIdByWorktree: { [TASKS]: 't-tasks' }
    })

    const focused = withProjectWindowFocus(read, new Set([TASKS, TERMINALS]))

    // A folder workspace is its own key, with no repo id — same shape the renderer stores.
    expect(focused.activeWorkspaceKey).toBe(TASKS)
    expect(focused.activeWorktreeId).toBe(TASKS)
    expect(focused.activeRepoId).toBeNull()
    expect(focused.activeTabId).toBe('t-tasks')
  })

  it('names the repo of a git worktree it opens on', () => {
    const read = session({
      tabsByWorktree: { [WORKTREE]: [makeTab('t-wt', WORKTREE)] }
    })

    const focused = withProjectWindowFocus(read, new Set([WORKTREE]))

    expect(focused.activeWorkspaceKey).toBe(`worktree:${WORKTREE}`)
    expect(focused.activeWorktreeId).toBe(WORKTREE)
    expect(focused.activeRepoId).toBe('repo-a')
    expect(focused.activeTabId).toBe('t-wt')
  })

  it('leaves a read that already carries its focus untouched', () => {
    const read = session({
      activeWorktreeId: TERMINALS,
      activeWorkspaceKey: TERMINALS,
      activeTabId: 't-terminals',
      tabsByWorktree: {
        [TASKS]: [makeTab('t-tasks', TASKS)],
        [TERMINALS]: [makeTab('t-terminals', TERMINALS)]
      },
      lastVisitedAtByWorktreeId: { [TASKS]: 2_000, [TERMINALS]: 1_000 }
    })

    expect(withProjectWindowFocus(read, new Set([TASKS, TERMINALS]))).toBe(read)
  })

  it('selects nothing when no workspace it serves has tabs', () => {
    const read = session({
      lastVisitedAtByWorktreeId: { [TASKS]: 2_000 },
      activeWorktreeIdsOnShutdown: [TASKS]
    })

    const focused = withProjectWindowFocus(read, new Set([TASKS]))

    expect(focused.activeWorkspaceKey).toBeNull()
    expect(focused.activeWorktreeId).toBeNull()
  })
})
