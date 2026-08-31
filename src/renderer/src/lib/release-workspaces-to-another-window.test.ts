import { describe, expect, it, vi } from 'vitest'
import type * as AgentStatusModule from '@/lib/agent-status'
import { releaseWorkspacesToAnotherWindow } from '@/lib/release-workspaces-to-another-window'
import { folderWorkspaceKey, worktreeWorkspaceKey } from '../../../shared/workspace-scope'
import {
  createTestStore,
  makeWorktree,
  makeTab,
  makeLayout
} from '../store/slices/store-test-helpers'
import { createStoreSessionMockApi } from '../store/slices/store-session-test-harness'

vi.mock('sonner', () => ({
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() }
}))

vi.mock('@/lib/agent-status', async (importOriginal) => {
  const actual = await importOriginal<typeof AgentStatusModule>()
  return {
    ...actual,
    detectAgentStatusFromTitle: vi.fn().mockReturnValue(null)
  }
})

createStoreSessionMockApi()

const PROJECT_WT = 'repo1::/path/project'
const KEPT_WT = 'repo2::/path/kept'
const PROJECT_FOLDER = folderWorkspaceKey('terminals')

function seedWindow(): ReturnType<typeof createTestStore> {
  const store = createTestStore()
  store.setState({
    repos: [
      {
        id: 'repo1',
        path: '/repo1',
        displayName: 'Repo 1',
        badgeColor: '#000',
        addedAt: 0
      },
      {
        id: 'repo2',
        path: '/repo2',
        displayName: 'Repo 2',
        badgeColor: '#000',
        addedAt: 0
      }
    ],
    worktreesByRepo: {
      repo1: [
        makeWorktree({
          id: PROJECT_WT,
          repoId: 'repo1',
          path: '/path/project'
        })
      ],
      repo2: [makeWorktree({ id: KEPT_WT, repoId: 'repo2', path: '/path/kept' })]
    }
  })
  store.getState().hydrateWorkspaceSession({
    activeRepoId: 'repo1',
    activeWorktreeId: PROJECT_WT,
    activeWorkspaceKey: worktreeWorkspaceKey(PROJECT_WT),
    activeTabId: 'tab-project',
    tabsByWorktree: {
      [PROJECT_WT]: [makeTab({ id: 'tab-project', worktreeId: PROJECT_WT })],
      [PROJECT_FOLDER]: [makeTab({ id: 'tab-folder', worktreeId: PROJECT_FOLDER })],
      [KEPT_WT]: [makeTab({ id: 'tab-kept', worktreeId: KEPT_WT })]
    },
    terminalLayoutsByTabId: {
      'tab-project': makeLayout(),
      'tab-folder': makeLayout(),
      'tab-kept': makeLayout()
    }
  })
  return store
}

describe('releaseWorkspacesToAnotherWindow', () => {
  it('drops the workspaces a project window took over and keeps the rest', () => {
    const store = seedWindow()

    releaseWorkspacesToAnotherWindow(store.getState(), [PROJECT_WT, PROJECT_FOLDER])

    const state = store.getState()
    expect(state.tabsByWorktree[PROJECT_WT]).toBeUndefined()
    expect(state.tabsByWorktree[PROJECT_FOLDER]).toBeUndefined()
    expect(state.tabsByWorktree[KEPT_WT]).toHaveLength(1)
  })

  it('clears the focus it just gave away', () => {
    const store = seedWindow()

    releaseWorkspacesToAnotherWindow(store.getState(), [PROJECT_WT, PROJECT_FOLDER])

    const state = store.getState()
    expect(state.activeWorktreeId).toBeNull()
    expect(state.activeWorkspaceKey).toBeNull()
  })

  it('keeps a focus that names a workspace it still serves', () => {
    const store = seedWindow()
    store.setState({
      activeWorktreeId: KEPT_WT,
      activeWorkspaceKey: worktreeWorkspaceKey(KEPT_WT),
      activeTabId: 'tab-kept'
    })

    releaseWorkspacesToAnotherWindow(store.getState(), [PROJECT_WT, PROJECT_FOLDER])

    const state = store.getState()
    expect(state.activeWorktreeId).toBe(KEPT_WT)
    expect(state.activeTabId).toBe('tab-kept')
  })

  it('does nothing for keys this window is not showing', () => {
    const store = seedWindow()
    const before = store.getState().tabsByWorktree

    releaseWorkspacesToAnotherWindow(store.getState(), ['repo9::/path/elsewhere'])

    expect(store.getState().tabsByWorktree).toBe(before)
  })
})
