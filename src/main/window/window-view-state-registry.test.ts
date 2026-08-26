import { beforeEach, describe, expect, it } from 'vitest'
import {
  _resetWindowViewStateRegistryForTests,
  bindWindowIdToWebContents,
  createWindowId,
  ensureWindowViewState,
  getWebContentsIdsForWindowId,
  getWindowViewState,
  rebindWebContentsToWindowId,
  resolveWindowIdForWebContents,
  resolveWindowScopeForWebContents,
  setScopedWindowsEnabled,
  unbindWindowIdFromWebContents,
  updateWindowViewState
} from './window-view-state-registry'

const seed = () => ({ filterRepoIds: ['seed-repo'], filterGroupIds: [] })

describe('window view state registry', () => {
  beforeEach(() => {
    _resetWindowViewStateRegistryForTests()
  })

  it('issues distinct ids per window', () => {
    expect(createWindowId()).not.toBe(createWindowId())
  })

  it('resolves a bound webContents to its window id and forgets it on unbind', () => {
    bindWindowIdToWebContents(17, 'win-a')

    expect(resolveWindowIdForWebContents(17)).toBe('win-a')
    expect(resolveWindowIdForWebContents(99)).toBeNull()

    unbindWindowIdFromWebContents(17)

    expect(resolveWindowIdForWebContents(17)).toBeNull()
  })

  it('seeds a window on first read and keeps that baseline on later reads', () => {
    expect(getWindowViewState('win-a')).toBeNull()

    const first = ensureWindowViewState('win-a', seed)
    const second = ensureWindowViewState('win-a', () => ({
      filterRepoIds: ['other'],
      filterGroupIds: []
    }))

    expect(first).toEqual({ filterRepoIds: ['seed-repo'], filterGroupIds: [] })
    expect(second).toBe(first)
  })

  it('keeps each window isolated from the other', () => {
    ensureWindowViewState('win-a', seed)
    ensureWindowViewState('win-b', seed)

    updateWindowViewState('win-a', { filterRepoIds: ['perc'] }, seed)
    updateWindowViewState('win-b', { filterGroupIds: ['cce-group'] }, seed)

    expect(getWindowViewState('win-a')).toEqual({ filterRepoIds: ['perc'], filterGroupIds: [] })
    expect(getWindowViewState('win-b')).toEqual({
      filterRepoIds: ['seed-repo'],
      filterGroupIds: ['cce-group']
    })
  })

  it('drops the view state once the last webContents of a window unbinds', () => {
    bindWindowIdToWebContents(17, 'win-a')
    updateWindowViewState('win-a', { filterRepoIds: ['perc'] }, seed)

    unbindWindowIdFromWebContents(17)

    expect(getWindowViewState('win-a')).toBeNull()
  })

  describe('project-scoped windows', () => {
    it('derives a scoped window view-state from its id instead of the persisted seed', () => {
      setScopedWindowsEnabled(true)
      bindWindowIdToWebContents(17, 'group:perc')

      expect(ensureWindowViewState('group:perc', seed)).toEqual({
        filterRepoIds: [],
        filterGroupIds: ['perc']
      })
      expect(resolveWindowScopeForWebContents(17)).toEqual({
        type: 'project-group',
        projectGroupId: 'perc'
      })
    })

    it('treats a scope key as a plain id while multi-window is off', () => {
      // Why: with the flag off every open path collapses to the single window, so a derived
      // filter would leave the user filtered with no UI to undo it.
      setScopedWindowsEnabled(false)
      bindWindowIdToWebContents(17, 'group:perc')

      expect(ensureWindowViewState('group:perc', seed)).toEqual({
        filterRepoIds: ['seed-repo'],
        filterGroupIds: []
      })
      expect(resolveWindowScopeForWebContents(17)).toBeNull()
    })

    it('lets a scoped window widen its picks but never detach its group', () => {
      setScopedWindowsEnabled(true)

      const next = updateWindowViewState(
        'group:perc',
        { filterRepoIds: ['cli'], filterGroupIds: [] },
        seed
      )

      expect(next).toEqual({
        filterRepoIds: ['cli'],
        filterGroupIds: ['perc']
      })
    })

    it('re-keys a webContents and drops the state left under the old id', () => {
      setScopedWindowsEnabled(true)
      bindWindowIdToWebContents(17, 'win-a')
      updateWindowViewState('win-a', { filterRepoIds: ['perc'] }, seed)

      rebindWebContentsToWindowId(17, 'group:perc')

      expect(resolveWindowIdForWebContents(17)).toBe('group:perc')
      expect(getWebContentsIdsForWindowId('group:perc')).toEqual([17])
      expect(getWindowViewState('win-a')).toBeNull()
      expect(ensureWindowViewState('group:perc', seed).filterGroupIds).toEqual(['perc'])
    })
  })
})
