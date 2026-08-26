import type { WindowScope } from '../../../../shared/window-scope'
import { deriveWindowViewState, type WindowViewState } from '../../../../shared/window-view-state'

/**
 * How the project filter relates to the window's scope. A free window's baseline is "no project
 * filter"; a scoped window's baseline is the filter derived from its project group, and no
 * "clear filters" path may go below it — that would silently drop the window's identity.
 */

export type WindowProjectFilterState = {
  windowScope?: WindowScope | null
  filterRepoIds: readonly string[]
  filterGroupIds: readonly string[]
}

export function getWindowProjectFilterBaseline(
  scope: WindowScope | null | undefined
): WindowViewState {
  return scope ? deriveWindowViewState(scope) : { filterRepoIds: [], filterGroupIds: [] }
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

/** Whether the project filter narrows (or, in a scoped window, widens) beyond the window's baseline. */
export function isProjectFilterActive(state: WindowProjectFilterState): boolean {
  const baseline = getWindowProjectFilterBaseline(state.windowScope)
  return (
    !sameIds(state.filterRepoIds, baseline.filterRepoIds) ||
    !sameIds(state.filterGroupIds, baseline.filterGroupIds)
  )
}

/** "Clear the project filter" for this window: back to the baseline, never to empty in a scoped one. */
export function resetProjectFilterToWindowBaseline(
  state: WindowProjectFilterState & {
    setFilterRepoIds: (ids: readonly string[]) => void
    setFilterGroupIds: (ids: readonly string[]) => void
  }
): void {
  const baseline = getWindowProjectFilterBaseline(state.windowScope)
  if (!sameIds(state.filterRepoIds, baseline.filterRepoIds)) {
    state.setFilterRepoIds(baseline.filterRepoIds)
  }
  if (!sameIds(state.filterGroupIds, baseline.filterGroupIds)) {
    state.setFilterGroupIds(baseline.filterGroupIds)
  }
}
