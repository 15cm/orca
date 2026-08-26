import { describe, expect, it } from 'vitest'
import {
  isSameWindowScope,
  parseWindowScopeKey,
  projectGroupWindowScopeKey,
  windowScopeKey
} from './window-scope'
import { deriveWindowViewState } from './window-view-state'

describe('window scope key', () => {
  it('round-trips a project group through its scope key', () => {
    const key = projectGroupWindowScopeKey('perc')

    expect(key).toBe('group:perc')
    expect(parseWindowScopeKey(key)).toEqual({
      type: 'project-group',
      projectGroupId: 'perc'
    })
    expect(windowScopeKey({ type: 'project-group', projectGroupId: 'perc' })).toBe(key)
  })

  it('reads a per-launch uuid and an empty group id as a free window', () => {
    expect(parseWindowScopeKey('6f1c2d3e-0000-4000-8000-000000000000')).toBeNull()
    expect(parseWindowScopeKey('group:')).toBeNull()
    expect(parseWindowScopeKey('')).toBeNull()
  })

  it('compares scopes by value', () => {
    const perc = { type: 'project-group' as const, projectGroupId: 'perc' }

    expect(isSameWindowScope(perc, { ...perc })).toBe(true)
    expect(isSameWindowScope(perc, { ...perc, projectGroupId: 'cce' })).toBe(false)
    expect(isSameWindowScope(null, null)).toBe(true)
    expect(isSameWindowScope(perc, null)).toBe(false)
  })
})

describe('deriveWindowViewState', () => {
  it('is a pure function of the scope: no picks, only the bound group', () => {
    const scope = { type: 'project-group' as const, projectGroupId: 'perc' }

    expect(deriveWindowViewState(scope)).toEqual({
      filterRepoIds: [],
      filterGroupIds: ['perc']
    })
    expect(deriveWindowViewState(scope)).toEqual(deriveWindowViewState(scope))
  })
})
