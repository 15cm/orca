import { describe, expect, it } from 'vitest'
import { getDefaultUIState } from './constants'
import {
  IMPLICIT_WINDOW_ID,
  formatWindowIdArgument,
  parseWindowIdFromArgv,
  WINDOW_ID_ARGV_FLAG
} from './window-identity'
import {
  isWindowViewStateKey,
  mergeWindowViewState,
  pickWindowViewState,
  splitWindowViewUpdates,
  WINDOW_VIEW_STATE_FIELDS,
  WINDOW_VIEW_STATE_KEYS
} from './window-view-state'

describe('window identity argv', () => {
  it('round-trips a window id through the preload argv flag', () => {
    const argument = formatWindowIdArgument('win-abc')

    expect(argument).toBe(`${WINDOW_ID_ARGV_FLAG}win-abc`)
    expect(parseWindowIdFromArgv(['electron', '--type=renderer', argument])).toBe('win-abc')
  })

  it('reports no id for renderers launched without the flag', () => {
    expect(parseWindowIdFromArgv(['electron', '--type=renderer'])).toBeNull()
    expect(parseWindowIdFromArgv([`${WINDOW_ID_ARGV_FLAG}   `])).toBeNull()
    expect(IMPLICIT_WINDOW_ID).not.toBe('')
  })
})

describe('window view state', () => {
  it('copies only the per-window keys out of a UI snapshot', () => {
    const ui = {
      ...getDefaultUIState(),
      filterRepoIds: ['repo-a'],
      filterGroupIds: ['group-1'],
      uiZoomLevel: 2
    }

    const view = pickWindowViewState(ui)

    expect(view).toEqual({ filterRepoIds: ['repo-a'], filterGroupIds: ['group-1'] })
    expect(view.filterRepoIds).not.toBe(ui.filterRepoIds)
    expect(Object.keys(view)).toEqual([...WINDOW_VIEW_STATE_KEYS])
  })

  it('treats a pre-feature snapshot without filterGroupIds as an empty group filter', () => {
    const { filterGroupIds: _dropped, ...legacy } = getDefaultUIState()
    void _dropped

    expect(pickWindowViewState(legacy as never).filterGroupIds).toEqual([])
  })

  it('splits a ui:set payload into window-owned and profile-owned parts', () => {
    const split = splitWindowViewUpdates({
      filterRepoIds: ['repo-a'],
      uiZoomLevel: 1,
      sidebarWidth: 300
    })

    expect(split.windowView).toEqual({ filterRepoIds: ['repo-a'] })
    expect(split.global).toEqual({ uiZoomLevel: 1, sidebarWidth: 300 })
  })

  it('reports no window view for a global-only payload', () => {
    const split = splitWindowViewUpdates({ uiZoomLevel: 1 })

    expect(split.windowView).toBeNull()
    expect(split.global).toEqual({ uiZoomLevel: 1 })
  })

  it('merges only the keys an update names', () => {
    const merged = mergeWindowViewState(
      { filterRepoIds: ['repo-a'], filterGroupIds: ['group-1'] },
      { filterGroupIds: [] }
    )

    expect(merged).toEqual({ filterRepoIds: ['repo-a'], filterGroupIds: [] })
  })

  it('drives keys, membership and normalization from the one field table', () => {
    expect(WINDOW_VIEW_STATE_KEYS).toEqual(WINDOW_VIEW_STATE_FIELDS.map((field) => field.key))
    expect(isWindowViewStateKey('filterGroupIds')).toBe(true)
    expect(isWindowViewStateKey('uiZoomLevel')).toBe(false)

    const merged = mergeWindowViewState(
      { filterRepoIds: [], filterGroupIds: [] },
      { filterRepoIds: ['repo-a', 7, null] as never }
    )

    expect(merged).toEqual({ filterRepoIds: ['repo-a'], filterGroupIds: [] })
  })
})
