import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow, WebContents } from 'electron'

type FakeWindow = {
  id: number
  webContents: { id: number; send: ReturnType<typeof vi.fn>; isDestroyed: () => boolean }
  isDestroyed: () => boolean
}

const windows = new Map<number, FakeWindow>()

vi.mock('../../../window/main-window-registry', () => ({
  getMainWindows: () => Array.from(windows.values()),
  getMainWindowForWebContents: (sender: { id: number }) =>
    Array.from(windows.values()).find((window) => window.webContents.id === sender.id) ?? null,
  getMainWindowById: (id: number) => windows.get(id) ?? null
}))

import { setPtyHostBindings, type PtyIpcSurface } from '../../pty-host-bindings'
import { setLocalPtyProvider } from '../provider/registry'
import { setRuntimeDesktopSurface } from '../../../runtime/runtime-desktop-surface'
import {
  _resetWindowViewStateRegistryForTests,
  bindWindowIdToWebContents,
  setScopedWindowsEnabled
} from '../../../window/window-view-state-registry'
import { projectGroupWindowScopeKey } from '../../../../shared/window-scope'
import type { PtyIpcSession } from '../session'
import { PtyPendingDataDrainQueue } from '../../pty-pending-data-drain-queue'
import { settleRendererDeliveryForOwnerTransfer } from './accounting'
import { getPtyRendererWindow, isPtyOwnerWindowSender } from './owner-window'
import {
  handlePtyOwnerWindowsChanged,
  installPtyWindowOwnershipIpc,
  PTY_WINDOW_OWNERSHIP_CHANGED_CHANNEL,
  setPtyOwnerTransferSession
} from './owner-transfer'

const FREE_WINDOW = 1
const PERC_WINDOW = 2
const PERC_GROUP = 'group-perc'
const PTY = 'pty-perc'

function makeWindow(id: number): FakeWindow {
  const window: FakeWindow = {
    id,
    webContents: { id: 100 + id, send: vi.fn(), isDestroyed: () => false },
    isDestroyed: () => false
  }
  windows.set(id, window)
  return window
}

function makeSession(ptyOwners: Map<string, number>): PtyIpcSession {
  const session = {
    mainWindow: windows.get(FREE_WINDOW) as unknown as BrowserWindow,
    runtime: {
      resolveOwnerWindowIdForPtyId: (id: string) => ptyOwners.get(id) ?? null,
      getPtyOutputSequence: () => 4242,
      listPtyOwnerWindows: () =>
        Array.from(ptyOwners, ([ptyId, windowId]) => ({ ptyId, windowId })),
      claimPtyOwnerWindow: vi.fn(() => 'claimed' as const)
    },
    pendingData: new PtyPendingDataDrainQueue(() => 'active'),
    sshOutputIntake: null,
    pendingOverflowMarkedPtys: new Set<string>(),
    rendererDeliveryAccountingByPty: new Map(),
    rendererInFlightTotalChars: 0,
    pendingDroppedChars: 0,
    updateProducerFlowControl: vi.fn(),
    sendModelRestoreNeededMarker: vi.fn(() => true)
  }
  return session as unknown as PtyIpcSession
}

const acknowledgeDataEvent = vi.fn()
const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
const fakeIpc: PtyIpcSurface = {
  handle: (channel, listener) => {
    handlers.set(channel, listener as never)
  },
  on: () => {},
  removeHandler: (channel) => {
    handlers.delete(channel)
  },
  removeAllListeners: () => {}
}

beforeEach(() => {
  windows.clear()
  handlers.clear()
  acknowledgeDataEvent.mockReset()
  makeWindow(FREE_WINDOW)
  makeWindow(PERC_WINDOW)
  _resetWindowViewStateRegistryForTests()
  setScopedWindowsEnabled(true)
  bindWindowIdToWebContents(windows.get(FREE_WINDOW)!.webContents.id, 'free-window-uuid')
  bindWindowIdToWebContents(
    windows.get(PERC_WINDOW)!.webContents.id,
    projectGroupWindowScopeKey(PERC_GROUP)
  )
  setPtyHostBindings({ ipc: fakeIpc })
  setLocalPtyProvider({ acknowledgeDataEvent } as never)
  setRuntimeDesktopSurface({
    showNotification: () => false,
    findWindowById: (id) => (windows.get(id) as unknown as BrowserWindow) ?? null,
    findFocusedOrLastActiveWindow: () => null,
    countLiveWindows: () => windows.size,
    findWindowForBrowserPage: () => null,
    onIpc: () => {},
    removeIpcListener: () => {}
  })
})

afterEach(() => {
  setPtyOwnerTransferSession(null)
  setRuntimeDesktopSurface(null)
  setPtyHostBindings({})
  _resetWindowViewStateRegistryForTests()
})

describe('settleRendererDeliveryForOwnerTransfer', () => {
  it('repays the previous owner in-flight credit exactly once and restarts the baseline', () => {
    const session = makeSession(new Map([[PTY, PERC_WINDOW]]))
    session.rendererDeliveryAccountingByPty.set(PTY, {
      sentChars: 1000,
      ackedChars: 400,
      lastSendAtMs: 0,
      lastAckAtMs: null
    })
    session.rendererDeliveryAccountingByPty.set('pty-other', {
      sentChars: 50,
      ackedChars: 0,
      lastSendAtMs: 0,
      lastAckAtMs: null
    })
    session.rendererInFlightTotalChars = 650

    const result = settleRendererDeliveryForOwnerTransfer(session, PTY)

    expect(result.settledChars).toBe(600)
    expect(acknowledgeDataEvent).toHaveBeenCalledTimes(1)
    expect(acknowledgeDataEvent).toHaveBeenCalledWith(PTY, 600)
    expect(session.rendererDeliveryAccountingByPty.has(PTY)).toBe(false)
    expect(session.rendererDeliveryAccountingByPty.get('pty-other')?.sentChars).toBe(50)
    expect(session.rendererInFlightTotalChars).toBe(50)

    // A second settle (or a late ACK from the old owner) cannot repay anything again.
    expect(settleRendererDeliveryForOwnerTransfer(session, PTY).settledChars).toBe(0)
    expect(acknowledgeDataEvent).toHaveBeenCalledTimes(1)
  })

  it('drops the pending backlog the restore marker will repaint, and re-evaluates flow control', () => {
    const session = makeSession(new Map([[PTY, PERC_WINDOW]]))
    session.pendingData.set(PTY, { data: 'abcdef', startSeq: 10 } as never)

    const result = settleRendererDeliveryForOwnerTransfer(session, PTY)

    expect(result.droppedPendingChars).toBe(6)
    expect(session.pendingData.get(PTY)).toBeUndefined()
    expect(session.pendingDroppedChars).toBe(6)
    expect(session.updateProducerFlowControl).toHaveBeenCalledWith(PTY)
    expect(acknowledgeDataEvent).not.toHaveBeenCalled()
  })
})

describe('handlePtyOwnerWindowsChanged', () => {
  it('settles the hand-off, asks the new owner to repaint, and tells every window who owns what', () => {
    const session = makeSession(new Map([[PTY, PERC_WINDOW]]))
    session.rendererDeliveryAccountingByPty.set(PTY, {
      sentChars: 300,
      ackedChars: 100,
      lastSendAtMs: 0,
      lastAckAtMs: null
    })
    session.rendererInFlightTotalChars = 200
    setPtyOwnerTransferSession(session)

    handlePtyOwnerWindowsChanged([
      { ptyId: PTY, previousWindowId: FREE_WINDOW, nextWindowId: PERC_WINDOW }
    ])

    expect(acknowledgeDataEvent).toHaveBeenCalledWith(PTY, 200)
    expect(session.sendModelRestoreNeededMarker).toHaveBeenCalledWith(PTY, 'owner-change', 4242)
    expect(windows.get(FREE_WINDOW)!.webContents.send).toHaveBeenCalledWith(
      PTY_WINDOW_OWNERSHIP_CHANGED_CHANNEL,
      [{ ptyId: PTY, ownedByThisWindow: false, owner: { projectGroupId: PERC_GROUP } }]
    )
    expect(windows.get(PERC_WINDOW)!.webContents.send).toHaveBeenCalledWith(
      PTY_WINDOW_OWNERSHIP_CHANGED_CHANNEL,
      [{ ptyId: PTY, ownedByThisWindow: true, owner: { projectGroupId: PERC_GROUP } }]
    )
  })

  it('names a free owner with a null project group', () => {
    const session = makeSession(new Map([[PTY, FREE_WINDOW]]))
    setPtyOwnerTransferSession(session)

    handlePtyOwnerWindowsChanged([
      { ptyId: PTY, previousWindowId: PERC_WINDOW, nextWindowId: FREE_WINDOW }
    ])

    expect(windows.get(PERC_WINDOW)!.webContents.send).toHaveBeenCalledWith(
      PTY_WINDOW_OWNERSHIP_CHANGED_CHANNEL,
      [{ ptyId: PTY, ownedByThisWindow: false, owner: { projectGroupId: null } }]
    )
  })

  it('does not settle or repaint for a first owner or a PTY losing its last owner', () => {
    const session = makeSession(new Map([[PTY, PERC_WINDOW]]))
    session.rendererDeliveryAccountingByPty.set(PTY, {
      sentChars: 300,
      ackedChars: 100,
      lastSendAtMs: 0,
      lastAckAtMs: null
    })
    setPtyOwnerTransferSession(session)

    handlePtyOwnerWindowsChanged([
      { ptyId: PTY, previousWindowId: null, nextWindowId: PERC_WINDOW },
      { ptyId: 'pty-gone', previousWindowId: FREE_WINDOW, nextWindowId: null }
    ])

    expect(acknowledgeDataEvent).not.toHaveBeenCalled()
    expect(session.sendModelRestoreNeededMarker).not.toHaveBeenCalled()
    expect(session.rendererDeliveryAccountingByPty.get(PTY)?.sentChars).toBe(300)
    expect(windows.get(FREE_WINDOW)!.webContents.send).toHaveBeenCalledWith(
      PTY_WINDOW_OWNERSHIP_CHANGED_CHANNEL,
      [
        { ptyId: PTY, ownedByThisWindow: false, owner: { projectGroupId: PERC_GROUP } },
        { ptyId: 'pty-gone', ownedByThisWindow: false, owner: null }
      ]
    )
  })

  it('is inert while scoped windows are off', () => {
    setScopedWindowsEnabled(false)
    const session = makeSession(new Map([[PTY, PERC_WINDOW]]))
    session.rendererDeliveryAccountingByPty.set(PTY, {
      sentChars: 300,
      ackedChars: 100,
      lastSendAtMs: 0,
      lastAckAtMs: null
    })
    setPtyOwnerTransferSession(session)

    handlePtyOwnerWindowsChanged([
      { ptyId: PTY, previousWindowId: FREE_WINDOW, nextWindowId: PERC_WINDOW }
    ])

    expect(acknowledgeDataEvent).not.toHaveBeenCalled()
    expect(session.sendModelRestoreNeededMarker).not.toHaveBeenCalled()
    expect(windows.get(FREE_WINDOW)!.webContents.send).not.toHaveBeenCalled()
    expect(windows.get(PERC_WINDOW)!.webContents.send).not.toHaveBeenCalled()
  })
})

describe('delivery follows the live owner index', () => {
  it('routes pty:data to whichever window the runtime resolves right now', () => {
    const owners = new Map([[PTY, FREE_WINDOW]])
    const session = makeSession(owners)

    expect(getPtyRendererWindow(session, PTY)?.id).toBe(FREE_WINDOW)
    owners.set(PTY, PERC_WINDOW)
    expect(getPtyRendererWindow(session, PTY)?.id).toBe(PERC_WINDOW)
  })

  it('only credits ACKs from the owning window; an unowned PTY accepts any main window', () => {
    const owners = new Map([[PTY, PERC_WINDOW]])
    const session = makeSession(owners)
    const freeSender = windows.get(FREE_WINDOW)!.webContents as unknown as WebContents
    const percSender = windows.get(PERC_WINDOW)!.webContents as unknown as WebContents

    expect(isPtyOwnerWindowSender(session, percSender, PTY)).toBe(true)
    expect(isPtyOwnerWindowSender(session, freeSender, PTY)).toBe(false)
    expect(isPtyOwnerWindowSender(session, freeSender, 'pty-unowned')).toBe(true)
  })
})

describe('window ownership IPC', () => {
  it('answers the sender window with its own view and forwards claims with the sender id', async () => {
    const session = makeSession(
      new Map([
        [PTY, PERC_WINDOW],
        ['pty-bank', FREE_WINDOW]
      ])
    )
    installPtyWindowOwnershipIpc(session)
    const freeEvent = { sender: windows.get(FREE_WINDOW)!.webContents }

    expect(await handlers.get('pty:getWindowOwnership')!(freeEvent)).toEqual([
      { ptyId: PTY, ownedByThisWindow: false, owner: { projectGroupId: PERC_GROUP } },
      { ptyId: 'pty-bank', ownedByThisWindow: true, owner: { projectGroupId: null } }
    ])
    expect(await handlers.get('pty:claimOwnerWindow')!(freeEvent, { id: PTY })).toEqual({
      status: 'claimed'
    })
    expect(session.runtime?.claimPtyOwnerWindow).toHaveBeenCalledWith(PTY, FREE_WINDOW)
  })

  it('refuses unknown senders, bad ids and the flag being off', async () => {
    const session = makeSession(new Map([[PTY, PERC_WINDOW]]))
    installPtyWindowOwnershipIpc(session)
    const freeEvent = { sender: windows.get(FREE_WINDOW)!.webContents }

    expect(
      await handlers.get('pty:claimOwnerWindow')!({ sender: { id: 999 } }, { id: PTY })
    ).toEqual({ status: 'unavailable' })
    expect(await handlers.get('pty:claimOwnerWindow')!(freeEvent, { id: '' })).toEqual({
      status: 'unavailable'
    })
    setScopedWindowsEnabled(false)
    expect(await handlers.get('pty:claimOwnerWindow')!(freeEvent, { id: PTY })).toEqual({
      status: 'unavailable'
    })
    expect(await handlers.get('pty:getWindowOwnership')!(freeEvent)).toEqual([])
    expect(session.runtime?.claimPtyOwnerWindow).not.toHaveBeenCalled()
  })
})
