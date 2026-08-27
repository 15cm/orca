import { clearProcessedPtyCharTotal } from '@/components/terminal-pane/terminal-pty-ack-gate'
import {
  applyPtyWindowOwnership,
  hydratePtyWindowOwnership,
  onPtyBecameOwnedByThisWindow
} from '@/lib/pane-manager/pty-window-ownership-state'
import type { PtyWindowOwnershipEntry } from '../../../../shared/pty-window-ownership'

const MAX_PENDING_OWNERSHIP_EVENTS = 300

/**
 * Feeds pty-window-ownership-state from main. Same shape as the mobile-driver bridge: subscribe
 * first, hydrate the snapshot, then replay pushes that arrived meanwhile in order.
 */
export function registerPtyWindowOwnershipIpcBridge(
  unsubs: (() => void)[],
  isRuntimeEnvironmentActive: () => boolean
): () => void {
  const api = window.api.pty
  if (
    !api ||
    typeof api.onWindowOwnershipChanged !== 'function' ||
    typeof api.getWindowOwnership !== 'function'
  ) {
    return () => {}
  }
  let hydrated = isRuntimeEnvironmentActive()
  let disposed = false
  const pending: PtyWindowOwnershipEntry[][] = []

  // Why: main deleted this PTY's delivery accounting on the hand-off, so our cumulative ACK
  // total must restart at zero too or every ACK below the old total is ignored (a stall).
  unsubs.push(onPtyBecameOwnedByThisWindow((ptyId) => clearProcessedPtyCharTotal(ptyId)))
  unsubs.push(
    api.onWindowOwnershipChanged((entries) => {
      if (isRuntimeEnvironmentActive()) {
        return
      }
      if (!hydrated) {
        pending.push(entries)
        while (pending.length > MAX_PENDING_OWNERSHIP_EVENTS) {
          pending.shift()
        }
        return
      }
      applyPtyWindowOwnership(entries)
    })
  )
  if (!isRuntimeEnvironmentActive()) {
    void api
      .getWindowOwnership()
      .then((entries) => {
        if (disposed) {
          return
        }
        hydratePtyWindowOwnership(entries)
      })
      .catch((error: unknown) => {
        if (!disposed) {
          console.error('Failed to hydrate PTY window ownership:', error)
        }
      })
      .finally(() => {
        if (disposed) {
          return
        }
        hydrated = true
        for (const entries of pending) {
          applyPtyWindowOwnership(entries)
        }
        pending.length = 0
      })
  }
  return () => {
    disposed = true
    pending.length = 0
  }
}
