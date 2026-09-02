import { beforeEach, describe, expect, it, vi } from 'vitest'

const { closeWebRuntimeSessionTabMock, getStateMock, isWebRuntimeSessionActiveMock } = vi.hoisted(
  () => ({
    closeWebRuntimeSessionTabMock: vi.fn(),
    getStateMock: vi.fn(),
    isWebRuntimeSessionActiveMock: vi.fn(() => false)
  })
)

vi.mock('@/store', () => ({ useAppStore: { getState: getStateMock } }))
vi.mock('@/runtime/web-runtime-session', () => ({
  closeWebRuntimeSessionTab: closeWebRuntimeSessionTabMock,
  isWebRuntimeSessionActive: isWebRuntimeSessionActiveMock,
  toHostSessionTabId: (tabId: string) => tabId
}))
vi.mock('@/runtime/web-session-tabs-sync', () => ({
  getLatestWebSessionTabsPublicationEpoch: vi.fn(() => 'epoch-1'),
  resolveHostSessionTabIdForWebSessionTab: vi.fn(() => null)
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

import { toast } from 'sonner'

import {
  closeOtherTerminalTabs,
  closeTerminalTab,
  closeTerminalTabsToRight
} from './terminal-tab-actions'

type CloseTerminalTab = (
  args: {
    worktreeId: string
    tabId: string
    confirmed?: boolean
  },
  executionHostId?: string
) => Promise<{ closed: boolean; pinned: boolean }>

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function makeState(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    settings: { activeRuntimeEnvironmentId: null, confirmClosePinnedTab: false },
    repos: [{ id: 'repo', executionHostId: 'local', connectionId: null }],
    worktreesByRepo: { repo: [{ id: 'wt', repoId: 'repo' }] },
    tabsByWorktree: { wt: [{ id: 'terminal-1' }, { id: 'terminal-2' }] },
    unifiedTabsByWorktree: {},
    activeWorktreeId: 'wt',
    activeTabId: 'terminal-1',
    openFiles: [],
    browserTabsByWorktree: {},
    closeTab: vi.fn(),
    closeUnifiedTab: vi.fn(),
    setActiveTab: vi.fn(),
    setActiveWorktree: vi.fn(),
    setActiveFile: vi.fn(),
    setActiveBrowserTab: vi.fn(),
    setActiveTabType: vi.fn(),
    requestPinnedTabCloseConfirm: vi.fn(),
    closeFile: vi.fn(),
    ...overrides
  }
}

function installSessionApi(closeTerminalTab: CloseTerminalTab): void {
  globalThis.window = { api: { session: { closeTerminalTab } } } as never
}

describe('durable terminal close', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isWebRuntimeSessionActiveMock.mockReturnValue(false)
    installSessionApi(vi.fn())
  })

  it.each([
    ['local', 'local'],
    ['SSH', 'ssh:build-host']
  ])('waits for %s persistence before local close', async (_label, executionHostId) => {
    const persistence = deferred<{ closed: boolean; pinned: boolean }>()
    const closeTerminalTabMock = vi.fn(() => persistence.promise)
    installSessionApi(closeTerminalTabMock)
    const state = makeState({
      repos: [{ id: 'repo', executionHostId, connectionId: null }]
    })
    getStateMock.mockReturnValue(state)

    closeTerminalTab('terminal-1')
    expect(closeTerminalTabMock).toHaveBeenCalledWith(
      { worktreeId: 'wt', tabId: 'terminal-1', confirmed: false },
      executionHostId
    )
    expect(state.closeTab).not.toHaveBeenCalled()

    persistence.resolve({ closed: true, pinned: false })
    await vi.waitFor(() => expect(state.closeTab).toHaveBeenCalledWith('terminal-1'))
  })

  it('leaves state untouched, cancels, and reports persistence failure', async () => {
    const persistence = deferred<{ closed: boolean; pinned: boolean }>()
    const closeTerminalTabMock = vi.fn(() => persistence.promise)
    installSessionApi(closeTerminalTabMock)
    const state = makeState()
    const onCancel = vi.fn()
    getStateMock.mockReturnValue(state)

    closeTerminalTab('terminal-1', { onCancel })
    persistence.reject(new Error('disk full'))

    await vi.waitFor(() => expect(onCancel).toHaveBeenCalledOnce())
    expect(state.closeTab).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('Failed to persist terminal close')
  })

  it('deduplicates concurrent close attempts', async () => {
    const persistence = deferred<{ closed: boolean; pinned: boolean }>()
    const closeTerminalTabMock = vi.fn(() => persistence.promise)
    installSessionApi(closeTerminalTabMock)
    const state = makeState()
    getStateMock.mockReturnValue(state)

    closeTerminalTab('terminal-1')
    closeTerminalTab('terminal-1')
    expect(closeTerminalTabMock).toHaveBeenCalledOnce()
    expect(state.closeTab).not.toHaveBeenCalled()

    persistence.resolve({ closed: true, pinned: false })
    await vi.waitFor(() => expect(state.closeTab).toHaveBeenCalledOnce())
  })

  it.each([
    ['cleanup', { hostCloseReason: 'cleanup' as const }],
    ['pty-exit', { reason: 'pty-exit' as const }],
    ['host lifecycle', { hostCloseReason: 'pty-exit' as const, lifecyclePtyId: 'pty-1' }]
  ])('does not use desktop durable IPC for %s lifecycle close', (_label, options) => {
    const closeTerminalTabMock = vi.fn()
    installSessionApi(closeTerminalTabMock)
    const state = makeState()
    getStateMock.mockReturnValue(state)

    closeTerminalTab('terminal-1', options)

    expect(closeTerminalTabMock).not.toHaveBeenCalled()
  })

  it('does not use desktop durable IPC for runtime web paths', () => {
    const closeTerminalTabMock = vi.fn()
    installSessionApi(closeTerminalTabMock)
    isWebRuntimeSessionActiveMock.mockReturnValue(true)
    const state = makeState({
      settings: { activeRuntimeEnvironmentId: 'web-runtime' },
      repos: [{ id: 'repo', executionHostId: 'runtime:web-runtime', connectionId: null }]
    })
    getStateMock.mockReturnValue(state)

    closeTerminalTab('terminal-1')

    expect(closeTerminalTabMock).not.toHaveBeenCalled()
    expect(closeWebRuntimeSessionTabMock).toHaveBeenCalledOnce()
  })

  it('preserves recently-closed capture after persistence succeeds', async () => {
    const persistence = Promise.resolve({ closed: true, pinned: false })
    const closeTerminalTabMock = vi.fn(() => persistence)
    installSessionApi(closeTerminalTabMock)
    const state = makeState()
    getStateMock.mockReturnValue(state)

    closeTerminalTab('terminal-1')
    await vi.waitFor(() => expect(state.closeTab).toHaveBeenCalledWith('terminal-1'))
    expect(state.closeTab).toHaveBeenCalledTimes(1)
  })

  it('sends confirmed true for a force-confirmed pinned close', () => {
    const persistence = deferred<{ closed: boolean; pinned: boolean }>()
    const closeTerminalTabMock = vi.fn(() => persistence.promise)
    installSessionApi(closeTerminalTabMock)
    const state = makeState({
      unifiedTabsByWorktree: {
        wt: [{ id: 'pinned', entityId: 'terminal-1', contentType: 'terminal', isPinned: true }]
      }
    })
    getStateMock.mockReturnValue(state)

    closeTerminalTab('terminal-1', { force: true })

    expect(closeTerminalTabMock).toHaveBeenCalledWith(
      { worktreeId: 'wt', tabId: 'terminal-1', confirmed: true },
      'local'
    )
    persistence.resolve({ closed: true, pinned: false })
  })

  it('routes unpinned bulk local closes through durable IPC', async () => {
    const persistence = deferred<{ closed: boolean; pinned: boolean }>()
    const closeTerminalTabMock = vi.fn(() => persistence.promise)
    installSessionApi(closeTerminalTabMock)
    const state = makeState({ tabsByWorktree: { wt: [{ id: 'keep' }, { id: 'close-me' }] } })
    getStateMock.mockReturnValue(state)

    closeOtherTerminalTabs('keep', 'wt')
    expect(closeTerminalTabMock).toHaveBeenCalledOnce()
    expect(state.closeTab).not.toHaveBeenCalled()

    persistence.resolve({ closed: true, pinned: false })
    await vi.waitFor(() => expect(state.closeTab).toHaveBeenCalledWith('close-me'))
  })

  it('routes unpinned tabs-to-right through durable IPC', async () => {
    const persistence = deferred<{ closed: boolean; pinned: boolean }>()
    const closeTerminalTabMock = vi.fn(() => persistence.promise)
    installSessionApi(closeTerminalTabMock)
    const state = makeState({
      tabsByWorktree: { wt: [{ id: 'keep' }, { id: 'close-me' }] },
      tabBarOrderByWorktree: { wt: ['keep', 'close-me'] }
    })
    getStateMock.mockReturnValue(state)

    closeTerminalTabsToRight('keep', 'wt')
    expect(closeTerminalTabMock).toHaveBeenCalledOnce()
    expect(closeTerminalTabMock).toHaveBeenCalledWith(
      { worktreeId: 'wt', tabId: 'close-me', confirmed: false },
      'local'
    )

    persistence.resolve({ closed: true, pinned: false })
    await vi.waitFor(() => expect(state.closeTab).toHaveBeenCalledWith('close-me'))
  })
})
