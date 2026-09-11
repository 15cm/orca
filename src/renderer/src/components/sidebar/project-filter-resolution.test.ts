import { describe, expect, it, vi } from 'vitest'
import {
  EMPTY_PROJECT_GROUP_FILTER_REPO_ID,
  clearProjectFilterHidingRepo,
  dropDeletedProjectGroupFilterIds,
  resolveEffectiveFilterRepoIds,
  selectEffectiveFilterRepoIds
} from './project-filter-resolution'

function group(id: string, parentGroupId: string | null = null) {
  return { id, parentGroupId }
}

function repo(id: string, projectGroupId: string | null = null) {
  return { id, projectGroupId }
}

// perc ─┬─ services ─┬─ pay, bank
//       │            └─ services/internal ─ heimdall
//       ├─ lambdas ─ pricing
//       └─ suppliers (empty)
// tools ─ cli
const GROUPS = [
  group('perc'),
  group('services', 'perc'),
  group('services-internal', 'services'),
  group('lambdas', 'perc'),
  group('suppliers', 'perc'),
  group('tools')
]
const REPOS = [
  repo('pay', 'services'),
  repo('bank', 'services'),
  repo('heimdall', 'services-internal'),
  repo('pricing', 'lambdas'),
  repo('cli', 'tools'),
  repo('loose')
]

describe('resolveEffectiveFilterRepoIds', () => {
  it('returns the explicit picks untouched when no group is selected', () => {
    const filterRepoIds = ['pay']
    expect(
      resolveEffectiveFilterRepoIds({
        filterRepoIds,
        filterGroupIds: [],
        repos: REPOS,
        projectGroups: GROUPS
      })
    ).toBe(filterRepoIds)
  })

  it('expands a group to its direct members', () => {
    expect(
      resolveEffectiveFilterRepoIds({
        filterRepoIds: [],
        filterGroupIds: ['lambdas'],
        repos: REPOS,
        projectGroups: GROUPS
      })
    ).toEqual(['pricing'])
  })

  it('recurses through nested subgroups', () => {
    expect(
      [
        ...resolveEffectiveFilterRepoIds({
          filterRepoIds: [],
          filterGroupIds: ['perc'],
          repos: REPOS,
          projectGroups: GROUPS
        })
      ].sort()
    ).toEqual(['bank', 'heimdall', 'pay', 'pricing'])
  })

  it('unions explicit picks with group members without duplicates', () => {
    expect(
      resolveEffectiveFilterRepoIds({
        filterRepoIds: ['pay', 'loose'],
        filterGroupIds: ['services'],
        repos: REPOS,
        projectGroups: GROUPS
      })
    ).toEqual(['pay', 'loose', 'bank', 'heimdall'])
  })

  it('keeps the filter active when the only selected group is empty', () => {
    expect(
      resolveEffectiveFilterRepoIds({
        filterRepoIds: [],
        filterGroupIds: ['suppliers'],
        repos: REPOS,
        projectGroups: GROUPS
      })
    ).toEqual([EMPTY_PROJECT_GROUP_FILTER_REPO_ID])
  })

  it('ignores group ids the loaded catalogs do not know', () => {
    const filterRepoIds = ['cli']
    expect(
      resolveEffectiveFilterRepoIds({
        filterRepoIds,
        filterGroupIds: ['deleted-or-offline-host'],
        repos: REPOS,
        projectGroups: GROUPS
      })
    ).toBe(filterRepoIds)
  })

  it('falls back to no filter while catalogs are still empty at startup', () => {
    expect(
      resolveEffectiveFilterRepoIds({
        filterRepoIds: [],
        filterGroupIds: ['perc'],
        repos: [],
        projectGroups: []
      })
    ).toEqual([])
  })
})

describe('selectEffectiveFilterRepoIds', () => {
  it('keeps the previous identity when a repo refresh leaves membership unchanged', () => {
    const first = selectEffectiveFilterRepoIds({
      filterRepoIds: [],
      filterGroupIds: ['services'],
      repos: REPOS,
      projectGroups: GROUPS
    })
    const second = selectEffectiveFilterRepoIds({
      filterRepoIds: [],
      filterGroupIds: ['services'],
      repos: REPOS.map((entry) => ({ ...entry })),
      projectGroups: GROUPS
    })
    expect(second).toBe(first)
  })

  it('follows membership when a project joins a filtered group', () => {
    const before = selectEffectiveFilterRepoIds({
      filterRepoIds: [],
      filterGroupIds: ['lambdas'],
      repos: REPOS,
      projectGroups: GROUPS
    })
    const after = selectEffectiveFilterRepoIds({
      filterRepoIds: [],
      filterGroupIds: ['lambdas'],
      repos: [...REPOS, repo('new-lambda', 'lambdas')],
      projectGroups: GROUPS
    })
    expect(before).toEqual(['pricing'])
    expect(after).toEqual(['pricing', 'new-lambda'])
  })
})

describe('clearProjectFilterHidingRepo', () => {
  function makeState(overrides: { filterRepoIds?: string[]; filterGroupIds?: string[] }) {
    return {
      filterRepoIds: overrides.filterRepoIds ?? [],
      filterGroupIds: overrides.filterGroupIds ?? [],
      repos: REPOS,
      projectGroups: GROUPS,
      setFilterRepoIds: vi.fn(),
      setFilterGroupIds: vi.fn()
    }
  }

  it('leaves both halves alone when the repo is admitted through a group', () => {
    const state = makeState({ filterGroupIds: ['services'] })
    clearProjectFilterHidingRepo(state, 'heimdall')
    expect(state.setFilterRepoIds).not.toHaveBeenCalled()
    expect(state.setFilterGroupIds).not.toHaveBeenCalled()
  })

  it('clears only the halves that are set when the repo is hidden', () => {
    const state = makeState({ filterGroupIds: ['services'] })
    clearProjectFilterHidingRepo(state, 'cli')
    expect(state.setFilterRepoIds).not.toHaveBeenCalled()
    expect(state.setFilterGroupIds).toHaveBeenCalledWith([])
  })

  it('clears an empty-group filter, which hides every repo', () => {
    const state = makeState({ filterRepoIds: ['loose'], filterGroupIds: ['suppliers'] })
    clearProjectFilterHidingRepo(state, 'cli')
    expect(state.setFilterRepoIds).toHaveBeenCalledWith([])
    expect(state.setFilterGroupIds).toHaveBeenCalledWith([])
  })
})

describe('dropDeletedProjectGroupFilterIds', () => {
  it('removes ids the cascade deleted and keeps the array identity otherwise', () => {
    const filterGroupIds = ['services', 'offline-host-group']
    expect(
      dropDeletedProjectGroupFilterIds(filterGroupIds, GROUPS, [group('perc'), group('tools')])
    ).toEqual(['offline-host-group'])
    expect(dropDeletedProjectGroupFilterIds(filterGroupIds, GROUPS, GROUPS)).toBe(filterGroupIds)
  })
})
