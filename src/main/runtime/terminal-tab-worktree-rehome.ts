/**
 * Re-keys the worktree binding of a live terminal tab after the renderer moves it
 * to another workspace. Nothing here touches a process: the PTY, its handle, and
 * its scrollback stay exactly as they are — only the workspace they are attributed
 * to changes, so `resolveTerminalPane(paneKey, newWorktreeId)` stops reading the
 * move as a cross-workspace ownership violation.
 *
 * See docs/reference/tab-workspace-move.md.
 */

type WorktreeBound = { worktreeId: string }
type TabBound = WorktreeBound & { tabId: string }
type LeafBound = TabBound & { ptyId: string | null }
type PtyBound = WorktreeBound & { tabId: string | null; ptyId: string }

export type TerminalTabWorktreeRehomeRecords = {
  tabs: Map<string, TabBound>
  leaves: Map<string, LeafBound>
  ptys: Map<string, PtyBound>
}

/**
 * Rebinds the tab, its leaves and its PTY records to `worktreeId`.
 * Returns the PTY IDs that moved, so the caller can replay the shared
 * `recordPtyWorktree` lifecycle (which also rebinds the advertised-URL watcher).
 */
export function rehomeTerminalTabWorktreeRecords(
  records: TerminalTabWorktreeRehomeRecords,
  tabId: string,
  worktreeId: string
): string[] {
  const rehomedPtyIds = new Set<string>()

  const tab = records.tabs.get(tabId)
  if (tab && tab.worktreeId !== worktreeId) {
    tab.worktreeId = worktreeId
  }

  for (const leaf of records.leaves.values()) {
    if (leaf.tabId !== tabId) {
      continue
    }
    leaf.worktreeId = worktreeId
    if (leaf.ptyId) {
      rehomedPtyIds.add(leaf.ptyId)
    }
  }

  for (const pty of records.ptys.values()) {
    // Why also scan by tabId: a tab whose panes are unmounted has no leaf records,
    // but its PTYs stay registered and would keep the stale workspace.
    if (pty.tabId !== tabId) {
      continue
    }
    pty.worktreeId = worktreeId
    rehomedPtyIds.add(pty.ptyId)
  }

  return [...rehomedPtyIds]
}
