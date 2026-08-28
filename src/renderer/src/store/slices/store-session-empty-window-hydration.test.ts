import { describe, expect, it, vi } from 'vitest'
import type * as AgentStatusModule from '@/lib/agent-status'
import { adoptWorkspaceSessionRead } from '@/lib/empty-window-workspace-session'
import type { WorkspaceSessionHostRead } from '@/lib/workspace-session-host-hydration'
import { worktreeWorkspaceKey } from '../../../../shared/workspace-scope'
import { createTestStore, makeWorktree, makeTab, makeLayout } from './store-test-helpers'
import { createStoreSessionMockApi } from './store-session-test-harness'

vi.mock('sonner', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }))

vi.mock('@/lib/agent-status', async (importOriginal) => {
  const actual = await importOriginal<typeof AgentStatusModule>()
  return { ...actual, detectAgentStatusFromTitle: vi.fn().mockReturnValue(null) }
})

createStoreSessionMockApi()

const WORKTREE_ID = 'repo1::/path/wt1'

function seedCatalog(store: ReturnType<typeof createTestStore>): void {
  store.setState({
    repos: [{ id: 'repo1', path: '/repo1', displayName: 'Repo 1', badgeColor: '#000', addedAt: 0 }],
    worktreesByRepo: {
      repo1: [makeWorktree({ id: WORKTREE_ID, repoId: 'repo1', path: '/path/wt1' })]
    }
  })
}

function persistedSessionRead(): WorkspaceSessionHostRead {
  return {
    session: {
      activeRepoId: 'repo1',
      activeWorktreeId: WORKTREE_ID,
      activeWorkspaceKey: worktreeWorkspaceKey(WORKTREE_ID),
      activeTabId: 'tab-1',
      tabsByWorktree: { [WORKTREE_ID]: [makeTab({ id: 'tab-1', worktreeId: WORKTREE_ID })] },
      terminalLayoutsByTabId: { 'tab-1': makeLayout() },
      activeConnectionIdsAtShutdown: ['ssh-target-1'],
      lastVisitedAtByWorktreeId: { [WORKTREE_ID]: 1_700_000_000_000 },
      defaultTerminalTabsAppliedByWorktreeId: { [WORKTREE_ID]: true }
    },
    runtimeHostIdByWorkspaceSessionKey: {},
    contestedHostWorkspaceSessions: {},
    contestedPrimaryHostBySessionKey: {}
  }
}

describe('startup hydration for a window that opens empty', () => {
  it('leaves a project window with no active workspace and no tabs', () => {
    const store = createTestStore()
    seedCatalog(store)

    const read = adoptWorkspaceSessionRead(persistedSessionRead(), 'empty')
    store.getState().hydrateWorkspaceSession(read.session)
    store.getState().hydrateTabsSession(read.session)

    const state = store.getState()
    expect(state.activeWorkspaceKey).toBeNull()
    expect(state.activeWorktreeId).toBeNull()
    expect(state.activeRepoId).toBeNull()
    expect(state.activeTabId).toBeNull()
    expect(state.tabsByWorktree).toEqual({})
    expect(state.unifiedTabsByWorktree).toEqual({})
    expect(state.pendingReconnectWorktreeIds).toEqual([])
    // Why: a startup SSH restore would pull that target's remote workspace back into the window.
    expect(read.session.activeConnectionIdsAtShutdown ?? []).toEqual([])
  })

  it('keeps the ledgers an empty window still needs', () => {
    const read = adoptWorkspaceSessionRead(persistedSessionRead(), 'empty')

    // Why: dropping this one re-runs the repo's default tab template — and its commands.
    expect(read.session.defaultTerminalTabsAppliedByWorktreeId).toEqual({ [WORKTREE_ID]: true })
    expect(read.session.lastVisitedAtByWorktreeId).toEqual({ [WORKTREE_ID]: 1_700_000_000_000 })
  })

  it('still hydrates everything in the launch’s first window', () => {
    const store = createTestStore()
    seedCatalog(store)

    const persisted = persistedSessionRead()
    const read = adoptWorkspaceSessionRead(persisted, 'shared')
    expect(read).toBe(persisted)

    store.getState().hydrateWorkspaceSession(read.session)

    const state = store.getState()
    expect(state.activeWorktreeId).toBe(WORKTREE_ID)
    expect(state.activeRepoId).toBe('repo1')
    expect(state.activeTabId).toBe('tab-1')
    expect(state.tabsByWorktree[WORKTREE_ID]).toHaveLength(1)
    expect(read.session.activeConnectionIdsAtShutdown).toEqual(['ssh-target-1'])
  })
})
