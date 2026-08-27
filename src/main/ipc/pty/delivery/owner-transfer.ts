import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import type {
  PtyClaimOwnerWindowResult,
  PtyWindowOwnershipEntry
} from '../../../../shared/pty-window-ownership'
import type { PtyOwnerWindowChange } from '../../../runtime/window-pty-ownership-priority'
import { getMainWindowForWebContents, getMainWindows } from '../../../window/main-window-registry'
import {
  areScopedWindowsEnabled,
  resolveWindowScopeForWebContents
} from '../../../window/window-view-state-registry'
import { getPtyIpc } from '../../pty-host-bindings'
import { settleRendererDeliveryForOwnerTransfer } from './accounting'
import type { PtyIpcSession } from '../session'

/**
 * What happens when the runtime moves a PTY between windows (scope rebind, "bring here", a
 * window closing): the delivery session settles the old owner's credit, the new owner is told
 * to repaint from the model, and every window learns whether the pane it renders is live here
 * or a mirror of another window.
 */

export const PTY_WINDOW_OWNERSHIP_CHANGED_CHANNEL = 'pty:windowOwnershipChanged'

// Why module scope: the runtime reports changes through a construction-time dep, while the
// delivery session is (re)created per window registration; the latest one is the live one.
let transferSession: PtyIpcSession | null = null

export function setPtyOwnerTransferSession(session: PtyIpcSession | null): void {
  transferSession = session
}

function ownerDescriptorForWindow(window: BrowserWindow): PtyWindowOwnershipEntry['owner'] {
  return {
    projectGroupId: resolveWindowScopeForWebContents(window.webContents.id)?.projectGroupId ?? null
  }
}

export function buildPtyWindowOwnershipEntry(
  ptyId: string,
  ownerWindowId: number | null,
  forWindow: BrowserWindow
): PtyWindowOwnershipEntry {
  const owner =
    ownerWindowId === null
      ? null
      : (getMainWindows().find((window) => window.id === ownerWindowId) ?? null)
  return {
    ptyId,
    ownedByThisWindow: ownerWindowId !== null && ownerWindowId === forWindow.id,
    owner: owner ? ownerDescriptorForWindow(owner) : null
  }
}

function sendOwnershipToWindows(changes: readonly PtyOwnerWindowChange[]): void {
  for (const window of getMainWindows()) {
    if (window.isDestroyed() || window.webContents.isDestroyed()) {
      continue
    }
    const entries = changes.map((change) =>
      buildPtyWindowOwnershipEntry(change.ptyId, change.nextWindowId, window)
    )
    window.webContents.send(PTY_WINDOW_OWNERSHIP_CHANGED_CHANNEL, entries)
  }
}

/** Runtime dep: reacts to every owner-index diff. Inert while scoped windows are off. */
export function handlePtyOwnerWindowsChanged(changes: readonly PtyOwnerWindowChange[]): void {
  if (!areScopedWindowsEnabled()) {
    return
  }
  const session = transferSession
  if (session) {
    for (const change of changes) {
      // Why only real transfers: a first owner has no stale in-flight bytes, and a PTY losing
      // its last owner is going away — settling either would just churn the provider credit.
      if (change.previousWindowId === null || change.nextWindowId === null) {
        continue
      }
      settleRendererDeliveryForOwnerTransfer(session, change.ptyId)
      session.sendModelRestoreNeededMarker(
        change.ptyId,
        'owner-change',
        session.runtime?.getPtyOutputSequence(change.ptyId)
      )
    }
  }
  sendOwnershipToWindows(changes)
}

function senderMainWindow(event: IpcMainInvokeEvent): BrowserWindow | null {
  const window = getMainWindowForWebContents(event.sender)
  return window && !window.isDestroyed() ? window : null
}

export function installPtyWindowOwnershipIpc(session: PtyIpcSession): void {
  setPtyOwnerTransferSession(session)
  const ipcMain = getPtyIpc()
  ipcMain.removeHandler('pty:getWindowOwnership')
  ipcMain.handle('pty:getWindowOwnership', (event): PtyWindowOwnershipEntry[] => {
    const window = senderMainWindow(event)
    const runtime = session.runtime
    if (!window || !runtime || !areScopedWindowsEnabled()) {
      return []
    }
    return runtime
      .listPtyOwnerWindows()
      .map(({ ptyId, windowId }) => buildPtyWindowOwnershipEntry(ptyId, windowId, window))
  })
  ipcMain.removeHandler('pty:claimOwnerWindow')
  ipcMain.handle(
    'pty:claimOwnerWindow',
    (event, args: { id?: unknown }): PtyClaimOwnerWindowResult => {
      const window = senderMainWindow(event)
      const runtime = session.runtime
      if (
        !window ||
        !runtime ||
        !areScopedWindowsEnabled() ||
        typeof args?.id !== 'string' ||
        args.id.length === 0
      ) {
        return { status: 'unavailable' }
      }
      return { status: runtime.claimPtyOwnerWindow(args.id, window.id) }
    }
  )
}
