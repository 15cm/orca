import { describe, expect, it, vi } from 'vitest'
import {
  getWindowProjectFilterBaseline,
  isProjectFilterActive,
  resetProjectFilterToWindowBaseline
} from './window-scope-project-filter'

const PERC = { type: 'project-group' as const, projectGroupId: 'perc' }

describe('window scope project filter', () => {
  it('uses no filter as the baseline of a free window and the derived filter for a scoped one', () => {
    expect(getWindowProjectFilterBaseline(null)).toEqual({
      filterRepoIds: [],
      filterGroupIds: []
    })
    expect(getWindowProjectFilterBaseline(PERC)).toEqual({
      filterRepoIds: [],
      filterGroupIds: ['perc']
    })
  })

  it('counts any pick as active in a free window, unresolved group ids included', () => {
    expect(
      isProjectFilterActive({
        windowScope: null,
        filterRepoIds: [],
        filterGroupIds: []
      })
    ).toBe(false)
    expect(isProjectFilterActive({ filterRepoIds: ['pay'], filterGroupIds: [] })).toBe(true)
    expect(
      isProjectFilterActive({
        windowScope: null,
        filterRepoIds: [],
        filterGroupIds: ['remote']
      })
    ).toBe(true)
  })

  it('treats the derived filter of a scoped window as no filter, and anything beyond it as one', () => {
    expect(
      isProjectFilterActive({
        windowScope: PERC,
        filterRepoIds: [],
        filterGroupIds: ['perc']
      })
    ).toBe(false)
    expect(
      isProjectFilterActive({
        windowScope: PERC,
        filterRepoIds: ['cli'],
        filterGroupIds: ['perc']
      })
    ).toBe(true)
    expect(
      isProjectFilterActive({
        windowScope: PERC,
        filterRepoIds: [],
        filterGroupIds: []
      })
    ).toBe(true)
  })

  it('resets a scoped window to its derived filter, never to empty', () => {
    const state = {
      windowScope: PERC,
      filterRepoIds: ['cli'],
      filterGroupIds: ['perc', 'other'],
      setFilterRepoIds: vi.fn(),
      setFilterGroupIds: vi.fn()
    }

    resetProjectFilterToWindowBaseline(state)

    expect(state.setFilterRepoIds).toHaveBeenCalledWith([])
    expect(state.setFilterGroupIds).toHaveBeenCalledWith(['perc'])
  })

  it('does not churn setters that already sit on the baseline', () => {
    const scoped = {
      windowScope: PERC,
      filterRepoIds: [],
      filterGroupIds: ['perc'],
      setFilterRepoIds: vi.fn(),
      setFilterGroupIds: vi.fn()
    }
    const free = {
      windowScope: null,
      filterRepoIds: ['pay'],
      filterGroupIds: [],
      setFilterRepoIds: vi.fn(),
      setFilterGroupIds: vi.fn()
    }

    resetProjectFilterToWindowBaseline(scoped)
    resetProjectFilterToWindowBaseline(free)

    expect(scoped.setFilterRepoIds).not.toHaveBeenCalled()
    expect(scoped.setFilterGroupIds).not.toHaveBeenCalled()
    expect(free.setFilterRepoIds).toHaveBeenCalledWith([])
    expect(free.setFilterGroupIds).not.toHaveBeenCalled()
  })
})
