import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildStoreState,
  FUTURE_LEAF_ID,
  FUTURE_PANE_KEY,
  type AgentStatusSetData,
  type StoreLike,
  type StoreSubscribeListener
} from './ipc-events-agent-status-store-test-fixtures'
import {
  buildWindowApi,
  stubAuxiliaryModules,
  stubReactSyncEffect
} from './ipc-events-agent-status-window-test-fixtures'

type ReplayListenerHarness = {
  emitStatus: (data: AgentStatusSetData) => void
  observeNotification: ReturnType<typeof vi.fn>
  setAgentStatus: ReturnType<typeof vi.fn>
  storeState: StoreLike
  notifyStoreUpdate: () => void
}

async function createReplayListenerHarness(options?: {
  paneHydrated?: boolean
}): Promise<ReplayListenerHarness> {
  const setAgentStatus = vi.fn()
  const observeNotification = vi.fn()
  const onSetListenerRef: { current: ((data: AgentStatusSetData) => void) | null } = {
    current: null
  }
  const subscribeListenerRef: { current: StoreSubscribeListener | null } = { current: null }
  const paneHydrated = options?.paneHydrated === true
  const storeState = buildStoreState({
    setAgentStatus,
    workspaceSessionReady: true,
    tabsByWorktree: paneHydrated
      ? {
          'wt-1': [{ id: 'tab-future', ptyId: 'pty-1', worktreeId: 'wt-1', title: 'Agent Tab' }]
        }
      : {},
    terminalLayoutsByTabId: paneHydrated
      ? {
          'tab-future': {
            root: { type: 'leaf', leafId: FUTURE_LEAF_ID },
            activeLeafId: FUTURE_LEAF_ID,
            expandedLeafId: null
          }
        }
      : {},
    repos: [],
    worktreesByRepo: {}
  })

  stubReactSyncEffect()
  vi.doMock('../store', () => ({
    useAppStore: {
      subscribe: vi.fn((listener: StoreSubscribeListener) => {
        subscribeListenerRef.current = listener
        return () => {
          subscribeListenerRef.current = null
        }
      }),
      getState: () => storeState
    }
  }))
  vi.doMock('./agent-hook-completion-notifications', () => ({
    observeAgentHookCompletionForNotification: observeNotification,
    resetAgentHookCompletionNotificationCoordinators: vi.fn(),
    syncAgentHookCompletionNotificationSettings: vi.fn(),
    syncAgentHookCompletionNotificationsForStoreUpdate: vi.fn()
  }))
  stubAuxiliaryModules()
  vi.stubGlobal(
    'window',
    buildWindowApi({
      onSet: (listener) => {
        onSetListenerRef.current = listener
        return () => {}
      }
    })
  )

  const ipcEvents = await import('./useIpcEvents')
  const registerIpcEvents = ipcEvents.useIpcEvents
  registerIpcEvents()
  await Promise.resolve()
  if (!onSetListenerRef.current) {
    throw new Error('Expected agentStatus.onSet listener to be registered')
  }

  return {
    emitStatus: onSetListenerRef.current,
    observeNotification,
    setAgentStatus,
    storeState,
    notifyStoreUpdate: () => subscribeListenerRef.current?.(storeState, storeState)
  }
}

describe('useIpcEvents replayed agent status listener events', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
  })

  it('hydrates a marked completion after its pane appears without notifying', async () => {
    const harness = await createReplayListenerHarness()

    harness.emitStatus({
      paneKey: FUTURE_PANE_KEY,
      tabId: 'tab-future',
      worktreeId: 'wt-1',
      connectionId: null,
      state: 'done',
      prompt: 'cached completion',
      agentType: 'codex',
      terminalHandle: 'term-future',
      receivedAt: 1_700_000_000_000,
      stateStartedAt: 1_699_999_999_000,
      isReplay: true
    })

    expect(harness.setAgentStatus).not.toHaveBeenCalled()
    Object.assign(harness.storeState, {
      tabsByWorktree: {
        'wt-1': [{ id: 'tab-future', ptyId: 'pty-1', worktreeId: 'wt-1', title: 'Agent Tab' }]
      },
      terminalLayoutsByTabId: {
        'tab-future': {
          root: { type: 'leaf', leafId: FUTURE_LEAF_ID },
          activeLeafId: FUTURE_LEAF_ID,
          expandedLeafId: null
        }
      }
    })
    harness.notifyStoreUpdate()

    expect(harness.setAgentStatus).toHaveBeenCalledTimes(1)
    expect(harness.observeNotification).not.toHaveBeenCalled()
  })

  it('seeds marked working state and observes a later live completion', async () => {
    const harness = await createReplayListenerHarness({ paneHydrated: true })

    harness.emitStatus({
      paneKey: FUTURE_PANE_KEY,
      tabId: 'tab-future',
      worktreeId: 'wt-1',
      connectionId: null,
      state: 'working',
      prompt: 'cached task',
      agentType: 'codex',
      receivedAt: 1_700_000_000_000,
      stateStartedAt: 1_699_999_999_000,
      isReplay: true
    })
    expect(harness.observeNotification).toHaveBeenCalledTimes(1)
    expect(harness.observeNotification.mock.calls[0][0]).toEqual(
      expect.objectContaining({ seedOnly: true })
    )

    harness.emitStatus({
      paneKey: FUTURE_PANE_KEY,
      tabId: 'tab-future',
      worktreeId: 'wt-1',
      connectionId: null,
      state: 'done',
      prompt: 'fresh completion',
      agentType: 'codex',
      receivedAt: 1_700_000_001_000,
      stateStartedAt: 1_700_000_001_000
    })

    expect(harness.observeNotification).toHaveBeenCalledTimes(2)
    expect(harness.observeNotification.mock.calls[1][0]).not.toHaveProperty('seedOnly')
  })
})
