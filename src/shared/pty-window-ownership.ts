/**
 * Which main window a PTY's output is delivered to (docs/reference/per-window-view-state.md,
 * "Terminal ownership"). Main resolves one owner per PTY; every other window that renders the
 * same pane is a mirror and is told so, with a "bring here" affordance instead of a silent pane.
 */

/** The window a PTY currently belongs to, as far as a renderer needs to name it. */
export type PtyOwnerWindowDescriptor = {
  /** The project group the owning window is bound to; null means a free window. */
  projectGroupId: string | null
}

export type PtyWindowOwnershipEntry = {
  ptyId: string
  ownedByThisWindow: boolean
  /** Null when no window currently owns the PTY (nothing published it yet). */
  owner: PtyOwnerWindowDescriptor | null
}

export type PtyClaimOwnerWindowResult = {
  status: 'claimed' | 'already-owner' | 'unavailable'
}
