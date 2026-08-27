// Why: mirrors main's per-window view of PTY ownership (shared/pty-window-ownership). A pane
// whose PTY delivers to another window is a mirror: it shows the foreign-window notice with
// "bring here" instead of stale scrollback that never updates. Keyed by ptyId; fed by the IPC
// bridge, read at render time like mobile-driver-state.

import type {
  PtyOwnerWindowDescriptor,
  PtyWindowOwnershipEntry
} from '../../../../shared/pty-window-ownership'

const ownershipByPtyId = new Map<string, PtyWindowOwnershipEntry>()

type OwnershipChangeEvent = { ptyId: string; ownedByThisWindow: boolean }
type OwnershipChangeListener = (event: OwnershipChangeEvent) => void
const changeListeners = new Set<OwnershipChangeListener>()
// Why: on taking a PTY back the renderer's cumulative ACK total restarts with main's fresh
// accounting; a hydration or repeat "owned" entry must NOT reset it, only the actual transition.
const becameOwnerListeners = new Set<(ptyId: string) => void>()

export function onPtyWindowOwnershipChange(listener: OwnershipChangeListener): () => void {
  changeListeners.add(listener)
  return () => changeListeners.delete(listener)
}

export function onPtyBecameOwnedByThisWindow(listener: (ptyId: string) => void): () => void {
  becameOwnerListeners.add(listener)
  return () => becameOwnerListeners.delete(listener)
}

function notifyChange(event: OwnershipChangeEvent): void {
  for (const listener of changeListeners) {
    listener(event)
  }
}

function store(entry: PtyWindowOwnershipEntry, detectTransition: boolean): void {
  const previous = ownershipByPtyId.get(entry.ptyId)
  if (entry.owner === null) {
    ownershipByPtyId.delete(entry.ptyId)
  } else {
    ownershipByPtyId.set(entry.ptyId, entry)
  }
  if (
    detectTransition &&
    previous !== undefined &&
    !previous.ownedByThisWindow &&
    entry.ownedByThisWindow
  ) {
    for (const listener of becameOwnerListeners) {
      listener(entry.ptyId)
    }
  }
  notifyChange({ ptyId: entry.ptyId, ownedByThisWindow: entry.ownedByThisWindow })
}

export function applyPtyWindowOwnership(entries: readonly PtyWindowOwnershipEntry[]): void {
  for (const entry of entries) {
    store(entry, true)
  }
}

export function hydratePtyWindowOwnership(entries: readonly PtyWindowOwnershipEntry[]): void {
  const affectedPtyIds = new Set(ownershipByPtyId.keys())
  ownershipByPtyId.clear()
  for (const entry of entries) {
    affectedPtyIds.add(entry.ptyId)
    if (entry.owner !== null) {
      ownershipByPtyId.set(entry.ptyId, entry)
    }
  }
  // Why: hydration can land after panes mounted; tick every affected pane so a mirror cannot miss its notice.
  for (const ptyId of affectedPtyIds) {
    notifyChange({
      ptyId,
      ownedByThisWindow: ownershipByPtyId.get(ptyId)?.ownedByThisWindow ?? true
    })
  }
}

/** The window that owns a PTY this window merely mirrors; null when it is ours (or unknown). */
export function getForeignPtyOwnerWindow(ptyId: string): PtyOwnerWindowDescriptor | null {
  const entry = ownershipByPtyId.get(ptyId)
  return entry && !entry.ownedByThisWindow ? entry.owner : null
}

export function forgetPtyWindowOwnership(ptyId: string): void {
  ownershipByPtyId.delete(ptyId)
}

export function _resetPtyWindowOwnershipForTests(): void {
  ownershipByPtyId.clear()
  changeListeners.clear()
  becameOwnerListeners.clear()
}
