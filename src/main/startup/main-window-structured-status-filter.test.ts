// The renderer half of the half-migration seam.
//
// Until PR 2 retires `StructuredAgentSessionStatusBridge`, the renderer writes structured rows
// itself. Main forwarding them too would give one pane key two writers, so the window listener
// drops them — a filter nothing else asserts, which makes deleting it green everywhere.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EnrichedAgentHookEventPayload } from '../agent-hooks/server'

const hooks = vi.hoisted(() => ({
  listener: null as ((payload: EnrichedAgentHookEventPayload) => void) | null,
  setListener: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getPath: () => '', on: vi.fn(), isReady: () => true }
}))
vi.mock('../agent-hooks/server', () => ({
  agentHookServer: {
    setListener: (listener: ((payload: EnrichedAgentHookEventPayload) => void) | null) => {
      hooks.setListener(listener)
      hooks.listener = listener
    },
    setPaneStatusClearListener: vi.fn()
  }
}))
vi.mock('../agent-hooks/migration-unsupported-pty-state', () => ({
  setMigrationUnsupportedPtyListener: vi.fn()
}))
vi.mock('../window/dashboard-popout-window', () => ({
  getDashboardPopoutWindow: () => null
}))
vi.mock('./synthetic-title-runtime', () => ({
  driveSyntheticTitleFromHook: vi.fn(),
  shouldSuppressCodexAutoApprovalSyntheticTitleFromHook: () => false,
  stopAllSyntheticTitleSpinners: vi.fn()
}))

import {
  clearMainWindowAgentStatusListeners,
  installMainWindowAgentStatusListeners
} from './main-window-agent-status'
import { mainProcessState } from './main-process-state'

const sent: { channel: string; event: { paneKey: string } }[] = []

function statusPayload(
  over: Partial<EnrichedAgentHookEventPayload>
): EnrichedAgentHookEventPayload {
  return {
    paneKey: 'pane-1',
    tabId: 'tab-1',
    worktreeId: 'repo::/wt',
    connectionId: null,
    receivedAt: 1,
    stateStartedAt: 1,
    payload: { state: 'working', prompt: 'ship it', agentType: 'codex' },
    ...over
  } as EnrichedAgentHookEventPayload
}

function makeWindow(send: (channel: string, event: Record<string, unknown>) => void) {
  return {
    isDestroyed: () => false,
    webContents: { send }
  } as unknown as typeof mainProcessState.mainWindow
}

beforeEach(() => {
  clearMainWindowAgentStatusListeners()
  hooks.setListener.mockClear()
  sent.length = 0
  hooks.listener = null
  mainProcessState.runtime = null
  mainProcessState.mainWindow = {
    isDestroyed: () => false,
    webContents: {
      send: (channel: string, event: { paneKey: string }) => sent.push({ channel, event })
    }
  } as unknown as typeof mainProcessState.mainWindow
  installMainWindowAgentStatusListeners({
    window: mainProcessState.mainWindow!,
    maybeAutoRenameBranchOnFirstWork: vi.fn(),
    onRecordAgentState: vi.fn()
  })
})

describe('the main-window agent-status listener', () => {
  it('forwards a hook row but never a structured one', () => {
    expect(hooks.listener).not.toBeNull()

    hooks.listener!(statusPayload({ paneKey: 'hook-pane' }))
    hooks.listener!(
      statusPayload({
        paneKey: 'structured-agent-session-s1:leaf',
        structuredHost: 'owned'
      })
    )

    expect(sent.map((entry) => `${entry.channel}:${entry.event.paneKey}`)).toEqual([
      'agentStatus:set:hook-pane'
    ])
  })

  it('keeps one process listener and fans live rows to owner and mirror', () => {
    const first = mainProcessState.mainWindow!
    const mirrorEvents: { channel: string; event: Record<string, unknown> }[] = []
    const mirror = makeWindow((channel, event) => mirrorEvents.push({ channel, event }))
    installMainWindowAgentStatusListeners({
      window: mirror!,
      maybeAutoRenameBranchOnFirstWork: vi.fn(),
      onRecordAgentState: vi.fn()
    })
    expect(hooks.setListener).toHaveBeenCalledTimes(1)

    mainProcessState.runtime = {
      resolveOwnerWindowIdForPtyId: () => first!.id,
      getAgentStatusOrchestrationContextForPaneKey: () => undefined,
      getAgentStatusTerminalHandleForPaneKey: () => undefined,
      getAgentStatusLaunchConfigForPaneKey: () => undefined
    } as never
    hooks.listener!(statusPayload({ paneKey: 'owner-pane' }))

    expect(sent.at(-1)?.event).not.toHaveProperty('presentationOnly')
    expect(mirrorEvents.at(-1)?.event).toMatchObject({
      paneKey: 'owner-pane',
      presentationOnly: true
    })
  })

  it('does not clear the listener until the last window closes', () => {
    const survivor = makeWindow(() => {})
    installMainWindowAgentStatusListeners({
      window: survivor!,
      maybeAutoRenameBranchOnFirstWork: vi.fn(),
      onRecordAgentState: vi.fn()
    })
    clearMainWindowAgentStatusListeners(mainProcessState.mainWindow!)
    expect(hooks.listener).not.toBeNull()
    clearMainWindowAgentStatusListeners(survivor!)
    expect(hooks.listener).toBeNull()
  })
})
