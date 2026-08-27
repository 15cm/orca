import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NotificationSettings } from '../../shared/notification-settings-types'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'

const {
  appFocusMock,
  getFocusedOrLastActiveMainWindowMock,
  getMainWindowByIdMock,
  getMainWindowTabFocusSequenceMock,
  getTrustedUIRendererWindowMock,
  recordNotificationDeliveryOutcomeMock,
  retainNotificationUntilReleaseMock,
  notificationCtorMock
} = vi.hoisted(() => ({
  appFocusMock: vi.fn(),
  getFocusedOrLastActiveMainWindowMock: vi.fn(),
  getMainWindowByIdMock: vi.fn(),
  getMainWindowTabFocusSequenceMock: vi.fn(),
  getTrustedUIRendererWindowMock: vi.fn(),
  notificationCtorMock: vi.fn(),
  recordNotificationDeliveryOutcomeMock: vi.fn(),
  retainNotificationUntilReleaseMock: vi.fn()
}))

vi.mock('electron', () => ({
  Notification: notificationCtorMock,
  app: { focus: appFocusMock }
}))

vi.mock('./native-notification-lifecycle', () => ({
  activeNotificationsById: new Map(),
  logNativeNotificationFailure: vi.fn(),
  retainNotificationUntilRelease: retainNotificationUntilReleaseMock,
  waitForNotificationDisplay: vi.fn()
}))

vi.mock('./notification-permission-probe', () => ({
  recordNotificationDeliveryOutcome: recordNotificationDeliveryOutcomeMock
}))

vi.mock('./notification-sound-selection', () => ({
  getEffectiveNotificationSoundId: vi.fn(() => 'system')
}))

vi.mock('./ui', () => ({
  getTrustedUIRendererWindow: getTrustedUIRendererWindowMock
}))

vi.mock('../window/main-window-registry', () => ({
  getFocusedOrLastActiveMainWindow: getFocusedOrLastActiveMainWindowMock,
  getMainWindowById: getMainWindowByIdMock,
  getMainWindowTabFocusSequence: getMainWindowTabFocusSequenceMock
}))

import { deliverNativeNotification } from './native-notification-delivery'

const WORKTREE_ID = 'repo::/worktree'
const TAB_ID = 'tab-1'
const LEAF_ID = '11111111-1111-4111-8111-111111111111'
const PANE_KEY = `${TAB_ID}:${LEAF_ID}`

type TestWindow = {
  id: number
  webContents: {
    send: ReturnType<typeof vi.fn>
    isDestroyed: ReturnType<typeof vi.fn>
  }
  isDestroyed: ReturnType<typeof vi.fn>
  isMinimized: ReturnType<typeof vi.fn>
  restore: ReturnType<typeof vi.fn>
  show: ReturnType<typeof vi.fn>
  focus: ReturnType<typeof vi.fn>
}

function createWindow(id: number): TestWindow {
  return {
    id,
    webContents: { send: vi.fn(), isDestroyed: vi.fn(() => false) },
    isDestroyed: vi.fn(() => false),
    isMinimized: vi.fn(() => false),
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn()
  }
}

function getNotificationClickHandler(): () => void {
  const notification = notificationCtorMock.mock.results[0]?.value as {
    on: ReturnType<typeof vi.fn>
  }
  const handler = notification.on.mock.calls.find(([event]) => event === 'click')?.[1]
  if (typeof handler !== 'function') {
    throw new Error('notification click handler was not registered')
  }
  return handler
}

function makeRuntime(
  candidates: { windowId: number; leafId: string | null }[],
  canonicalLeafWindowId: number | null = null,
  canonicalTabWindowId: number | null = null,
  tabCandidates = candidates
): OrcaRuntimeService {
  return {
    getWindowGraphCandidates: vi.fn((_worktreeId: string, _tabId: string, leafId?: string | null) =>
      leafId ? candidates : tabCandidates
    ),
    isWindowGraphCandidate: vi.fn(
      (windowId: number, _worktreeId: string, _tabId: string, leafId?: string | null) =>
        (leafId ? candidates : tabCandidates).some(
          (candidate) =>
            candidate.windowId === windowId && (leafId === undefined || candidate.leafId === leafId)
        )
    ),
    resolveOwnerWindowIdForLeaf: vi.fn(() => canonicalLeafWindowId),
    resolveOwnerWindowIdForWorktreeTab: vi.fn(() => canonicalTabWindowId)
  } as never
}

const settings: NotificationSettings = {
  enabled: true,
  agentTaskComplete: true,
  terminalBell: true,
  suppressWhenFocused: false,
  customSoundId: 'system',
  customSoundPath: null,
  customSoundVolume: 1
}

function dispatchAndClick(
  args: Parameters<typeof deliverNativeNotification>[0],
  runtime?: Parameters<typeof deliverNativeNotification>[3]
): void {
  deliverNativeNotification(args, { title: 'Task complete', body: 'Done' }, settings, runtime)
  getNotificationClickHandler()()
}

describe('deliverNativeNotification routing', () => {
  beforeEach(() => {
    const notification = {
      on: vi.fn(),
      removeListener: vi.fn(),
      show: vi.fn()
    }
    notificationCtorMock.mockReset().mockImplementation(
      class NotificationMock {
        constructor() {
          return notification
        }
      } as unknown as (...args: unknown[]) => unknown
    )
    appFocusMock.mockReset()
    getFocusedOrLastActiveMainWindowMock.mockReset().mockReturnValue(null)
    getMainWindowByIdMock.mockReset().mockReturnValue(null)
    getMainWindowTabFocusSequenceMock.mockReset().mockReturnValue(null)
    getTrustedUIRendererWindowMock.mockReset().mockReturnValue(null)
    recordNotificationDeliveryOutcomeMock.mockReset()
    retainNotificationUntilReleaseMock.mockReset().mockReturnValue(vi.fn())
  })

  it('prefers the newest focus history among exact-pane candidates', () => {
    const older = createWindow(1)
    const newer = createWindow(2)
    const windows = new Map([
      [older.id, older],
      [newer.id, newer]
    ])
    getMainWindowByIdMock.mockImplementation((windowId: number) => windows.get(windowId) ?? null)
    getMainWindowTabFocusSequenceMock.mockImplementation((windowId: number) =>
      windowId === newer.id ? 2 : 1
    )
    const runtime = makeRuntime(
      [
        { windowId: older.id, leafId: LEAF_ID },
        { windowId: newer.id, leafId: LEAF_ID }
      ],
      older.id
    )

    dispatchAndClick(
      { source: 'agent-task-complete', worktreeId: WORKTREE_ID, paneKey: PANE_KEY },
      runtime
    )

    expect(newer.focus).toHaveBeenCalledOnce()
    expect(older.focus).not.toHaveBeenCalled()
    expect(runtime.resolveOwnerWindowIdForLeaf).toHaveBeenCalledWith(TAB_ID, LEAF_ID, WORKTREE_ID)
    expect(runtime.resolveOwnerWindowIdForWorktreeTab).not.toHaveBeenCalled()
    expect(newer.webContents.send).toHaveBeenCalledWith('ui:focusTerminal', {
      tabId: TAB_ID,
      worktreeId: WORKTREE_ID,
      leafId: LEAF_ID,
      ackPaneKeyOnSuccess: PANE_KEY,
      flashFocusedPane: true,
      scrollToBottomIfOutputSinceLastView: true
    })
  })

  it('skips a stale historical winner and retries the remaining ranked candidate', () => {
    const stale = createWindow(1)
    const live = createWindow(2)
    const windows = new Map([[live.id, live]])
    getMainWindowByIdMock.mockImplementation((windowId: number) => windows.get(windowId) ?? null)
    getMainWindowTabFocusSequenceMock.mockImplementation((windowId: number) =>
      windowId === stale.id ? 2 : 1
    )
    const runtime = makeRuntime(
      [
        { windowId: stale.id, leafId: LEAF_ID },
        { windowId: live.id, leafId: LEAF_ID }
      ],
      stale.id
    )

    dispatchAndClick(
      { source: 'agent-task-complete', worktreeId: WORKTREE_ID, paneKey: PANE_KEY },
      runtime
    )

    expect(getMainWindowByIdMock.mock.calls.map(([windowId]) => windowId)).toEqual([1, 2])
    expect(live.focus).toHaveBeenCalledOnce()
  })

  it('retries an unranked matching window after a stale canonical owner', () => {
    const stale = createWindow(6)
    const live = createWindow(7)
    getMainWindowByIdMock.mockImplementation((windowId: number) =>
      windowId === live.id ? live : null
    )
    const runtime = makeRuntime(
      [
        { windowId: stale.id, leafId: LEAF_ID },
        { windowId: live.id, leafId: LEAF_ID }
      ],
      stale.id
    )

    dispatchAndClick(
      { source: 'agent-task-complete', worktreeId: WORKTREE_ID, paneKey: PANE_KEY },
      runtime
    )

    expect(getMainWindowByIdMock.mock.calls.map(([windowId]) => windowId)).toEqual([6, 7])
    expect(live.focus).toHaveBeenCalledOnce()
  })

  it('retries a live window that no longer matches the graph', () => {
    const stale = createWindow(12)
    const live = createWindow(13)
    getMainWindowByIdMock.mockImplementation((windowId: number) =>
      windowId === stale.id ? stale : windowId === live.id ? live : null
    )
    const runtime = makeRuntime([
      { windowId: stale.id, leafId: LEAF_ID },
      { windowId: live.id, leafId: LEAF_ID }
    ])
    let staleChecks = 0
    ;(runtime.isWindowGraphCandidate as ReturnType<typeof vi.fn>).mockImplementation(
      (windowId: number) => windowId !== stale.id || staleChecks++ === 0
    )

    dispatchAndClick(
      { source: 'agent-task-complete', worktreeId: WORKTREE_ID, paneKey: PANE_KEY },
      runtime
    )

    expect(stale.focus).not.toHaveBeenCalled()
    expect(live.focus).toHaveBeenCalledOnce()
  })

  it('skips a destroyed candidate webContents and retries the next match', () => {
    const destroyedContents = createWindow(14)
    const live = createWindow(15)
    destroyedContents.webContents.isDestroyed.mockReturnValue(true)
    getMainWindowByIdMock.mockImplementation((windowId: number) =>
      windowId === destroyedContents.id ? destroyedContents : windowId === live.id ? live : null
    )
    const runtime = makeRuntime([
      { windowId: destroyedContents.id, leafId: LEAF_ID },
      { windowId: live.id, leafId: LEAF_ID }
    ])

    dispatchAndClick(
      { source: 'agent-task-complete', worktreeId: WORKTREE_ID, paneKey: PANE_KEY },
      runtime
    )

    expect(destroyedContents.focus).not.toHaveBeenCalled()
    expect(live.focus).toHaveBeenCalledOnce()
    expect(getMainWindowByIdMock.mock.calls.map(([windowId]) => windowId)).toEqual([14, 15])
  })

  it('falls through from a stale exact-pane owner to a live tab candidate', () => {
    const stale = createWindow(10)
    const live = createWindow(11)
    getMainWindowByIdMock.mockImplementation((windowId: number) =>
      windowId === live.id ? live : null
    )
    const runtime = makeRuntime([{ windowId: stale.id, leafId: LEAF_ID }], stale.id, null, [
      { windowId: stale.id, leafId: 'stale-active-leaf' },
      { windowId: live.id, leafId: 'live-active-leaf' }
    ])

    dispatchAndClick(
      { source: 'agent-task-complete', worktreeId: WORKTREE_ID, paneKey: PANE_KEY },
      runtime
    )

    expect(getMainWindowByIdMock.mock.calls.map(([windowId]) => windowId)).toEqual([10, 11])
    expect(live.focus).toHaveBeenCalledOnce()
  })

  it('uses a live canonical pane owner when no focus history exists', () => {
    const canonical = createWindow(7)
    getMainWindowByIdMock.mockReturnValue(canonical)
    const runtime = makeRuntime([{ windowId: canonical.id, leafId: LEAF_ID }], canonical.id)

    dispatchAndClick(
      { source: 'agent-task-complete', worktreeId: WORKTREE_ID, paneKey: PANE_KEY },
      runtime
    )

    expect(runtime.resolveOwnerWindowIdForLeaf).toHaveBeenCalledWith(TAB_ID, LEAF_ID, WORKTREE_ID)
    expect(canonical.focus).toHaveBeenCalledOnce()
  })

  it('does not query runtime with an empty tab identity', () => {
    const focused = createWindow(8)
    getFocusedOrLastActiveMainWindowMock.mockReturnValue(focused)
    const runtime = makeRuntime([], null, 8)

    dispatchAndClick(
      { source: 'agent-task-complete', worktreeId: WORKTREE_ID, paneKey: undefined },
      runtime
    )

    expect(runtime.getWindowGraphCandidates).not.toHaveBeenCalled()
    expect(runtime.resolveOwnerWindowIdForLeaf).not.toHaveBeenCalled()
    expect(runtime.resolveOwnerWindowIdForWorktreeTab).not.toHaveBeenCalled()
    expect(focused.focus).toHaveBeenCalledOnce()
  })

  it('routes folder workspace clicks through workspace-aware pane focus', () => {
    const folderWindow = createWindow(16)
    getMainWindowByIdMock.mockReturnValue(folderWindow)
    const runtime = makeRuntime([{ windowId: folderWindow.id, leafId: LEAF_ID }])
    const folderWorktreeId = 'folder:folder-1'

    dispatchAndClick(
      { source: 'agent-task-complete', worktreeId: folderWorktreeId, paneKey: PANE_KEY },
      runtime
    )

    expect(folderWindow.webContents.send).not.toHaveBeenCalledWith(
      'ui:activateWorktree',
      expect.anything()
    )
    expect(folderWindow.webContents.send).toHaveBeenCalledWith('ui:focusTerminal', {
      tabId: TAB_ID,
      worktreeId: folderWorktreeId,
      leafId: LEAF_ID,
      ackPaneKeyOnSuccess: PANE_KEY,
      flashFocusedPane: true,
      scrollToBottomIfOutputSinceLastView: true
    })
  })

  it('falls back to the focused window after all graph candidates become stale', () => {
    const focused = createWindow(9)
    getFocusedOrLastActiveMainWindowMock.mockReturnValue(focused)
    const runtime = makeRuntime([{ windowId: 1, leafId: LEAF_ID }], 1)

    dispatchAndClick(
      { source: 'agent-task-complete', worktreeId: WORKTREE_ID, paneKey: PANE_KEY },
      runtime
    )

    expect(focused.focus).toHaveBeenCalledOnce()
    expect(focused.webContents.send).toHaveBeenCalledWith('ui:activateWorktree', {
      repoId: 'repo',
      worktreeId: WORKTREE_ID
    })
  })
})
