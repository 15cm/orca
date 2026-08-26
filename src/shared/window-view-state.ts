import type { PersistedUIState } from './persisted-ui-state-types'
import type { WindowScope } from './window-scope'

/**
 * View-state a single window owns instead of the profile: today the project filter.
 *
 * Kept a plain, serializable subset of PersistedUIState on purpose. A window holds it in memory
 * for its lifetime; a scoped window derives it from its project group instead. Adding a field
 * means one row in WINDOW_VIEW_STATE_FIELDS — pick, merge, split and the ui:get overlay follow.
 */
export type WindowViewState = {
  filterRepoIds: string[]
  filterGroupIds: string[]
}

type WindowViewStateField<K extends keyof WindowViewState> = {
  key: K
  /** Normalizes an untrusted value (persisted blob, ui:set payload) into the field's shape. */
  read: (value: unknown) => WindowViewState[K]
}

function copyIdList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
}

export const WINDOW_VIEW_STATE_FIELDS = [
  { key: 'filterRepoIds', read: copyIdList },
  { key: 'filterGroupIds', read: copyIdList }
] as const satisfies readonly WindowViewStateField<keyof WindowViewState>[]

export const WINDOW_VIEW_STATE_KEYS = WINDOW_VIEW_STATE_FIELDS.map(
  (field) => field.key
) as readonly (keyof WindowViewState)[]

const WINDOW_VIEW_STATE_FIELD_BY_KEY: ReadonlyMap<
  string,
  WindowViewStateField<keyof WindowViewState>
> = new Map(WINDOW_VIEW_STATE_FIELDS.map((field) => [field.key, field]))

export function isWindowViewStateKey(key: string): key is keyof WindowViewState {
  return WINDOW_VIEW_STATE_FIELD_BY_KEY.has(key)
}

function buildWindowViewState(readField: (key: keyof WindowViewState) => unknown): WindowViewState {
  const state = {} as WindowViewState
  for (const field of WINDOW_VIEW_STATE_FIELDS) {
    state[field.key] = field.read(readField(field.key))
  }
  return state
}

/** Copies the per-window subset out of a UI snapshot; the seed for a free window that has none yet. */
export function pickWindowViewState(
  ui: Pick<PersistedUIState, keyof WindowViewState>
): WindowViewState {
  return buildWindowViewState((key) => ui[key])
}

export function mergeWindowViewState(
  current: WindowViewState,
  updates: Partial<WindowViewState>
): WindowViewState {
  return buildWindowViewState((key) => (updates[key] === undefined ? current[key] : updates[key]))
}

/**
 * A scoped window's view-state is a pure function of its scope: nothing to persist, and the
 * durability of the filter comes from the project group id already being durable.
 */
export function deriveWindowViewState(scope: WindowScope): WindowViewState {
  return { filterRepoIds: [], filterGroupIds: [scope.projectGroupId] }
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
    const field = WINDOW_VIEW_STATE_FIELD_BY_KEY.get(key)
    if (field) {
      hasWindowViewKey = true
      windowView[field.key] = field.read(value)
    } else {
      global[key] = value
    }
  }
  return {
    windowView: hasWindowViewKey ? windowView : null,
    global: global as Partial<PersistedUIState>
  }
}
