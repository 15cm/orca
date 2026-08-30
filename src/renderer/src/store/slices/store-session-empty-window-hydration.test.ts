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

describe('startup hydration for a scoped window', () => {
  it('uses main’s already-partitioned read without a renderer projection', () => {
    const persisted = persistedSessionRead()
    const read = adoptWorkspaceSessionRead(persisted, 'scoped')
    expect(read).toBe(persisted)
  })

  it('hydrates the keys main assigned to the project window', () => {
    const store = createTestStore()
    seedCatalog(store)
    const read = adoptWorkspaceSessionRead(persistedSessionRead(), 'scoped')
    store.getState().hydrateWorkspaceSession(read.session)
    expect(store.getState().activeWorktreeId).toBe(WORKTREE_ID)
    expect(store.getState().tabsByWorktree[WORKTREE_ID]).toHaveLength(1)
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
