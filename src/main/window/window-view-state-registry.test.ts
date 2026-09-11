import { beforeEach, describe, expect, it } from 'vitest'
import {
  _resetWindowViewStateRegistryForTests,
  bindWindowIdToWebContents,
  createWindowId,
  ensureWindowViewState,
  getWindowViewState,
  resolveWindowIdForWebContents,
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
})
