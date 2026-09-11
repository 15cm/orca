import type { PersistedUIState } from './persisted-ui-state-types'

/**
 * View-state a single window owns instead of the profile: today the project filter.
 *
 * Kept a plain, serializable subset of PersistedUIState on purpose. A window holds it in memory
 * for its lifetime; a future window profile becomes the durable owner of exactly this shape, so
 * adding a field here is what makes it per-window everywhere (ui:set routing, ui:get overlay,
 * sync-broadcast hydration).
 */
export type WindowViewState = {
  filterRepoIds: string[]
  filterGroupIds: string[]
}

export const WINDOW_VIEW_STATE_KEYS = [
  'filterRepoIds',
  'filterGroupIds'
] as const satisfies readonly (keyof WindowViewState)[]

const WINDOW_VIEW_STATE_KEY_SET: ReadonlySet<string> = new Set(WINDOW_VIEW_STATE_KEYS)

export function isWindowViewStateKey(key: string): key is keyof WindowViewState {
  return WINDOW_VIEW_STATE_KEY_SET.has(key)
}

function copyIdList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
}

/** Copies the per-window subset out of a UI snapshot; the seed for a window that has none yet. */
export function pickWindowViewState(
  ui: Pick<PersistedUIState, 'filterRepoIds' | 'filterGroupIds'>
): WindowViewState {
  return {
    filterRepoIds: copyIdList(ui.filterRepoIds),
    filterGroupIds: copyIdList(ui.filterGroupIds)
  }
}

export function mergeWindowViewState(
  current: WindowViewState,
  updates: Partial<WindowViewState>
): WindowViewState {
  return {
    filterRepoIds:
      updates.filterRepoIds === undefined
        ? current.filterRepoIds
        : copyIdList(updates.filterRepoIds),
    filterGroupIds:
      updates.filterGroupIds === undefined
        ? current.filterGroupIds
        : copyIdList(updates.filterGroupIds)
  }
}

/**
 * Splits a ui:set payload into what the sending window owns and what the profile owns.
 * `windowView` is null when the payload carries no per-window key, so callers can skip
 * registry writes for the common global-only update (theme, zoom, sidebar width…).
 */
export function splitWindowViewUpdates(updates: Partial<PersistedUIState>): {
  windowView: Partial<WindowViewState> | null
  global: Partial<PersistedUIState>
} {
  const windowView: Partial<WindowViewState> = {}
  const global: Record<string, unknown> = {}
  let hasWindowViewKey = false
  for (const [key, value] of Object.entries(updates)) {
    if (isWindowViewStateKey(key)) {
      hasWindowViewKey = true
      windowView[key] = copyIdList(value)
    } else {
      global[key] = value
    }
  }
  return {
    windowView: hasWindowViewKey ? windowView : null,
    global: global as Partial<PersistedUIState>
  }
}
