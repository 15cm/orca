import { describe, it, expect, vi, beforeEach } from 'vitest'
import type * as AgentStatusModule from '@/lib/agent-status'
import { buildPersistedUnifiedTabSessionData } from '@/lib/workspace-session-unified-tabs'
import { buildSanitizedTabsByWorktree } from '@/lib/workspace-session'
import { createTabsSliceMockApi } from './tabs-slice-test-harness'
import {
  createTestStore,
  makeOpenFile,
  makeTab,
  makeTabGroup,
  makeUnifiedTab,
  makeWorktree
} from './store-test-helpers'

vi.mock('sonner', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }))

vi.mock('@/lib/agent-status', async (importOriginal) => {
  const actual = await importOriginal<typeof AgentStatusModule>()
  return {
    ...actual,
    detectAgentStatusFromTitle: vi.fn().mockReturnValue(null)
  }
})

createTabsSliceMockApi()

const TASKS = 'folder:tasks'
const CLOSED = 'folder:closed'
const OTHER_FOLDER = 'folder:other'
const SHARED_PATH = '/tmp/perc'

type Store = ReturnType<typeof createTestStore>

function worktrees(closedPath = SHARED_PATH) {
  return {
    'folder-workspace:perc': [
      makeWorktree({ id: TASKS, repoId: 'folder-workspace:perc', path: SHARED_PATH }),
      makeWorktree({ id: CLOSED, repoId: 'folder-workspace:perc', path: closedPath }),
      makeWorktree({ id: OTHER_FOLDER, repoId: 'folder-workspace:perc', path: '/tmp/elsewhere' })
    ]
  }
}

/** Tasks holds a live agent terminal plus a sibling; Closed holds one terminal. */
function seedTerminalMove(store: Store, closedPath = SHARED_PATH): void {
  store.setState({
    worktreesByRepo: worktrees(closedPath),
    activeWorktreeId: TASKS,
    unifiedTabsByWorktree: {
      [TASKS]: [
        makeUnifiedTab({ id: 'agent', worktreeId: TASKS, groupId: 'tasks-group' }),
        makeUnifiedTab({ id: 'sibling', worktreeId: TASKS, groupId: 'tasks-group' })
      ],
      [CLOSED]: [makeUnifiedTab({ id: 'parked', worktreeId: CLOSED, groupId: 'closed-group' })]
    },
    groupsByWorktree: {
      [TASKS]: [
        makeTabGroup({
          id: 'tasks-group',
          worktreeId: TASKS,
          activeTabId: 'agent',
          tabOrder: ['agent', 'sibling'],
          recentTabIds: ['sibling', 'agent']
        })
      ],
      [CLOSED]: [
        makeTabGroup({
          id: 'closed-group',
          worktreeId: CLOSED,
          activeTabId: 'parked',
          tabOrder: ['parked']
        })
      ]
    },
    layoutByWorktree: {
      [TASKS]: { type: 'leaf', groupId: 'tasks-group' },
      [CLOSED]: { type: 'leaf', groupId: 'closed-group' }
    },
    activeGroupIdByWorktree: { [TASKS]: 'tasks-group', [CLOSED]: 'closed-group' },
    tabsByWorktree: {
      [TASKS]: [
        makeTab({ id: 'agent', worktreeId: TASKS, ptyId: 'pty-agent' }),
        makeTab({ id: 'sibling', worktreeId: TASKS, ptyId: 'pty-sibling' })
      ],
      [CLOSED]: [makeTab({ id: 'parked', worktreeId: CLOSED, ptyId: 'pty-parked' })]
    },
    terminalLayoutsByTabId: {
      agent: {
        root: { type: 'leaf', leafId: 'leaf-1' },
        activeLeafId: 'leaf-1',
        expandedLeafId: null,
        ptyIdsByLeafId: { 'leaf-1': 'pty-agent' }
      }
    },
    ptyIdsByTabId: { agent: ['pty-agent'] },
    tabBarOrderByWorktree: { [TASKS]: ['sibling', 'agent'] }
  })
}

describe('moveUnifiedTabToWorkspace', () => {
  let store: Store

  beforeEach(() => {
    store = createTestStore()
  })

  it('reassigns the tab and its terminal row to the destination workspace', () => {
    seedTerminalMove(store)

    const move = store.getState().moveUnifiedTabToWorkspace('agent', CLOSED)

    expect(move?.targetWorktreeId).toBe(CLOSED)
    const state = store.getState()
    expect(state.unifiedTabsByWorktree[TASKS].map((tab) => tab.id)).toEqual(['sibling'])
    const moved = state.unifiedTabsByWorktree[CLOSED].find((tab) => tab.id === 'agent')
    expect(moved).toMatchObject({ worktreeId: CLOSED, groupId: 'closed-group' })
    expect(state.tabsByWorktree[TASKS].map((tab) => tab.id)).toEqual(['sibling'])
    expect(state.tabsByWorktree[CLOSED].find((tab) => tab.id === 'agent')).toMatchObject({
      worktreeId: CLOSED,
      ptyId: 'pty-agent'
    })
  })

  it('keeps the live pane binding, which is keyed by tab and not by workspace', () => {
    seedTerminalMove(store)

    store.getState().moveUnifiedTabToWorkspace('agent', CLOSED)

    const state = store.getState()
    expect(state.terminalLayoutsByTabId.agent.ptyIdsByLeafId).toEqual({ 'leaf-1': 'pty-agent' })
    expect(state.ptyIdsByTabId.agent).toEqual(['pty-agent'])
  })

  it('appends to the destination group without stealing its focus', () => {
    seedTerminalMove(store)

    store.getState().moveUnifiedTabToWorkspace('agent', CLOSED)

    const closedGroup = store.getState().groupsByWorktree[CLOSED][0]
    expect(closedGroup.tabOrder).toEqual(['parked', 'agent'])
    expect(closedGroup.activeTabId).toBe('parked')
    expect(store.getState().activeTabIdByWorktree[CLOSED]).toBe('parked')
  })

  it('adopts the arrival when the destination group has no active tab', () => {
    seedTerminalMove(store)
    store.setState({
      groupsByWorktree: {
        ...store.getState().groupsByWorktree,
        [CLOSED]: [makeTabGroup({ id: 'closed-group', worktreeId: CLOSED })]
      },
      unifiedTabsByWorktree: { ...store.getState().unifiedTabsByWorktree, [CLOSED]: [] },
      tabsByWorktree: { ...store.getState().tabsByWorktree, [CLOSED]: [] }
    })

    store.getState().moveUnifiedTabToWorkspace('agent', CLOSED)

    expect(store.getState().groupsByWorktree[CLOSED][0]).toMatchObject({
      activeTabId: 'agent',
      tabOrder: ['agent']
    })
  })

  it('promotes the previously focused sibling in the source workspace', () => {
    seedTerminalMove(store)

    store.getState().moveUnifiedTabToWorkspace('agent', CLOSED)

    expect(store.getState().groupsByWorktree[TASKS][0]).toMatchObject({
      activeTabId: 'sibling',
      tabOrder: ['sibling']
    })
    expect(store.getState().activeTabId).toBe('sibling')
  })

  it('collapses the source group when it loses its last tab', () => {
    seedTerminalMove(store)
    store.setState({
      unifiedTabsByWorktree: {
        ...store.getState().unifiedTabsByWorktree,
        [TASKS]: [makeUnifiedTab({ id: 'agent', worktreeId: TASKS, groupId: 'tasks-group' })]
      },
      groupsByWorktree: {
        ...store.getState().groupsByWorktree,
        [TASKS]: [
          makeTabGroup({
            id: 'tasks-group',
            worktreeId: TASKS,
            activeTabId: 'agent',
            tabOrder: ['agent']
          })
        ]
      }
    })

    store.getState().moveUnifiedTabToWorkspace('agent', CLOSED)

    expect(store.getState().groupsByWorktree[TASKS]).toEqual([])
    expect(store.getState().layoutByWorktree[TASKS]).toBeUndefined()
  })

  it('moves the legacy tab-bar order entry with the tab', () => {
    seedTerminalMove(store)

    store.getState().moveUnifiedTabToWorkspace('agent', CLOSED)

    expect(store.getState().tabBarOrderByWorktree[TASKS]).toEqual(['sibling'])
    expect(store.getState().tabBarOrderByWorktree[CLOSED]).toEqual(['agent'])
  })

  it('leaves the working directory alone when both workspaces share a folder', () => {
    seedTerminalMove(store)

    const move = store.getState().moveUnifiedTabToWorkspace('agent', CLOSED)

    expect(move?.retainedCwd).toBeNull()
    expect(store.getState().tabsByWorktree[CLOSED][1].startupCwd).toBeUndefined()
  })

  it('pins the original cwd on the tab when the destination folder differs', () => {
    seedTerminalMove(store, '/tmp/perc-closed')

    const move = store.getState().moveUnifiedTabToWorkspace('agent', CLOSED)

    expect(move?.retainedCwd).toBe(SHARED_PATH)
    expect(store.getState().tabsByWorktree[CLOSED][1].startupCwd).toBe(SHARED_PATH)
  })

  it('refuses tabs whose content is derived from the source workspace git state', () => {
    seedTerminalMove(store)
    store.setState({
      unifiedTabsByWorktree: {
        ...store.getState().unifiedTabsByWorktree,
        [TASKS]: [
          makeUnifiedTab({
            id: 'diff',
            worktreeId: TASKS,
            groupId: 'tasks-group',
            contentType: 'diff'
          })
        ]
      }
    })

    expect(store.getState().moveUnifiedTabToWorkspace('diff', CLOSED)).toBeNull()
  })

  it('refuses a move onto the workspace the tab already lives in', () => {
    seedTerminalMove(store)

    expect(store.getState().moveUnifiedTabToWorkspace('agent', TASKS)).toBeNull()
  })

  it('rehomes an editor tab and re-roots its relative path', () => {
    store.setState({
      worktreesByRepo: worktrees('/tmp/perc-closed'),
      unifiedTabsByWorktree: {
        [TASKS]: [
          makeUnifiedTab({
            id: '/tmp/perc-closed/src/main.ts',
            worktreeId: TASKS,
            groupId: 'tasks-group',
            contentType: 'editor'
          })
        ]
      },
      groupsByWorktree: {
        [TASKS]: [
          makeTabGroup({
            id: 'tasks-group',
            worktreeId: TASKS,
            activeTabId: '/tmp/perc-closed/src/main.ts',
            tabOrder: ['/tmp/perc-closed/src/main.ts']
          })
        ],
        [CLOSED]: [makeTabGroup({ id: 'closed-group', worktreeId: CLOSED })]
      },
      activeGroupIdByWorktree: { [CLOSED]: 'closed-group' },
      openFiles: [
        makeOpenFile({
          id: '/tmp/perc-closed/src/main.ts',
          worktreeId: TASKS,
          relativePath: 'other/main.ts'
        })
      ]
    })

    store.getState().moveUnifiedTabToWorkspace('/tmp/perc-closed/src/main.ts', CLOSED)

    expect(store.getState().openFiles[0]).toMatchObject({
      worktreeId: CLOSED,
      relativePath: 'src/main.ts'
    })
  })

  it('rehomes a browser tab together with its workspace record', () => {
    store.setState({
      worktreesByRepo: worktrees(),
      unifiedTabsByWorktree: {
        [TASKS]: [
          makeUnifiedTab({
            id: 'browser-tab',
            worktreeId: TASKS,
            groupId: 'tasks-group',
            entityId: 'browser-ws',
            contentType: 'browser'
          })
        ]
      },
      groupsByWorktree: {
        [TASKS]: [
          makeTabGroup({
            id: 'tasks-group',
            worktreeId: TASKS,
            activeTabId: 'browser-tab',
            tabOrder: ['browser-tab']
          })
        ],
        [CLOSED]: [makeTabGroup({ id: 'closed-group', worktreeId: CLOSED })]
      },
      activeGroupIdByWorktree: { [CLOSED]: 'closed-group' },
      browserTabsByWorktree: {
        [TASKS]: [
          {
            id: 'browser-ws',
            worktreeId: TASKS,
            url: 'https://example.test',
            title: 'Example',
            loading: false,
            faviconUrl: null,
            canGoBack: false,
            canGoForward: false,
            loadError: null,
            createdAt: 0
          }
        ]
      }
    })

    store.getState().moveUnifiedTabToWorkspace('browser-tab', CLOSED)

    expect(store.getState().browserTabsByWorktree[TASKS]).toEqual([])
    expect(store.getState().browserTabsByWorktree[CLOSED][0]).toMatchObject({
      id: 'browser-ws',
      worktreeId: CLOSED
    })
  })

  it('keeps the tab in its new workspace across a session round trip', () => {
    seedTerminalMove(store)
    store.getState().moveUnifiedTabToWorkspace('agent', CLOSED)
    const moved = store.getState()

    const restored = createTestStore()
    restored.setState({ worktreesByRepo: worktrees() })
    restored.getState().hydrateTabsSession({
      activeRepoId: null,
      activeWorktreeId: CLOSED,
      activeTabId: 'agent',
      tabsByWorktree: buildSanitizedTabsByWorktree(moved.tabsByWorktree),
      terminalLayoutsByTabId: moved.terminalLayoutsByTabId,
      ...buildPersistedUnifiedTabSessionData(moved)
    })

    const state = restored.getState()
    expect(state.unifiedTabsByWorktree[CLOSED].map((tab) => tab.id)).toContain('agent')
    expect(state.unifiedTabsByWorktree[TASKS]?.map((tab) => tab.id) ?? []).not.toContain('agent')
  })
})
