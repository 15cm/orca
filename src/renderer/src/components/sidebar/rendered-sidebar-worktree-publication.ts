import type { Worktree } from '../../../../shared/worktree/types'

export type VisibleWorktreeShortcutTarget = {
  id: string
  executionHostId?: Worktree['hostId']
}

/**
 * What WorktreeList's render pipeline last put on screen.
 *
 * Why cached rather than recomputed: WorktreeList freezes its sort order via
 * sortedIds / sortEpoch, so recomputing from a live Zustand snapshot could name
 * a different workspace than the one rendered at that position — which would
 * make Cmd+1–9 and the tab context menu disagree with the visible card order.
 *
 * Why a leaf module: surfaces outside the sidebar (Cmd+1–9, the tab context
 * menu) need the rendered card order without importing the sidebar's row
 * pipeline, which reads a large slice of the store on every call.
 *
 * Why null vs []: [] is a real rendered order (everything collapsed/filtered);
 * null means WorktreeList is unmounted and nothing has been published.
 */
let publishedVisibleIds: string[] | null = null
let publishedVisibleShortcutTargets: VisibleWorktreeShortcutTarget[] | null = null

export function setVisibleWorktreeIds(ids: string[] | null): void {
  publishedVisibleIds = ids
}

export function getPublishedVisibleWorktreeIds(): string[] | null {
  return publishedVisibleIds
}

export function setVisibleWorktreeShortcutTargets(
  targets: VisibleWorktreeShortcutTarget[] | null
): void {
  publishedVisibleShortcutTargets = targets
}

export function getPublishedVisibleWorktreeShortcutTargets():
  | VisibleWorktreeShortcutTarget[]
  | null {
  return publishedVisibleShortcutTargets
}
