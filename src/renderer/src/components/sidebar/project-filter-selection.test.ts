import { describe, expect, it } from 'vitest'
import type { ProjectGroup } from '../../../../shared/project-group-types'
import type { Repo } from '../../../../shared/repo-types'
import { buildProjectFilterSelection } from './project-filter-selection'

function group(
  id: string,
  overrides: Partial<Pick<ProjectGroup, 'parentGroupId' | 'tabOrder' | 'name'>> = {}
): ProjectGroup {
  return {
    id,
    name: overrides.name ?? id,
    parentPath: null,
    parentGroupId: overrides.parentGroupId ?? null,
    createdFrom: 'manual',
    tabOrder: overrides.tabOrder ?? 0,
    isCollapsed: false,
    color: null,
    createdAt: 0,
    updatedAt: 0
  }
}

function repo(id: string, projectGroupId: string | null = null): Repo {
  return { id, displayName: id, path: `/tmp/${id}`, projectGroupId } as Repo
}

const GROUPS = [
  group('tools', { tabOrder: 1 }),
  group('perc', { tabOrder: 0 }),
  group('lambdas', { parentGroupId: 'perc', tabOrder: 1 }),
  group('services', { parentGroupId: 'perc', tabOrder: 0 }),
  group('internal', { parentGroupId: 'services' })
]
const REPOS = [
  repo('pay', 'services'),
  repo('heimdall', 'internal'),
  repo('pricing', 'lambdas'),
  repo('cli', 'tools'),
  repo('loose')
]

describe('buildProjectFilterSelection', () => {
  it('lists groups in sidebar order with depth and subtree project counts', () => {
    const selection = buildProjectFilterSelection({
      repos: REPOS,
      projectGroups: GROUPS,
      filterRepoIds: [],
      filterGroupIds: []
    })
    expect(
      selection.availableGroups.map((option) => [option.group.id, option.depth, option.repoCount])
    ).toEqual([
      ['perc', 0, 3],
      ['services', 1, 2],
      ['internal', 2, 1],
      ['lambdas', 1, 1],
      ['tools', 0, 1]
    ])
    expect(selection.availableRepos.map((entry) => entry.id)).toEqual([
      'pay',
      'heimdall',
      'pricing',
      'cli',
      'loose'
    ])
    expect(selection.hasRepoFilter).toBe(false)
    expect(selection.effectiveRepoCount).toBe(0)
  })

  it('moves a selected group to the chips and hides its subtree and members from the picker', () => {
    const selection = buildProjectFilterSelection({
      repos: REPOS,
      projectGroups: GROUPS,
      filterRepoIds: ['loose'],
      filterGroupIds: ['services']
    })
    expect(selection.selectedGroups.map((option) => option.group.id)).toEqual(['services'])
    expect(selection.selectedRepos.map((entry) => entry.id)).toEqual(['loose'])
    expect(selection.availableGroups.map((option) => option.group.id)).toEqual([
      'perc',
      'lambdas',
      'tools'
    ])
    expect(selection.availableRepos.map((entry) => entry.id)).toEqual(['pricing', 'cli'])
    expect(selection.effectiveRepoCount).toBe(3)
    expect(selection.hasRepoFilter).toBe(true)
  })

  it('treats an empty selected group as an active filter admitting nothing', () => {
    const selection = buildProjectFilterSelection({
      repos: REPOS,
      projectGroups: [...GROUPS, group('suppliers', { parentGroupId: 'perc', tabOrder: 2 })],
      filterRepoIds: [],
      filterGroupIds: ['suppliers']
    })
    expect(selection.selectedGroups.map((option) => option.group.id)).toEqual(['suppliers'])
    expect(selection.effectiveRepoCount).toBe(0)
    expect(selection.availableRepos).toHaveLength(REPOS.length)
    expect(selection.hasRepoFilter).toBe(true)
  })

  it('drops stale ids so they neither render chips nor count', () => {
    const selection = buildProjectFilterSelection({
      repos: REPOS,
      projectGroups: GROUPS,
      filterRepoIds: ['removed-repo'],
      filterGroupIds: ['deleted-group']
    })
    expect(selection.selectedGroups).toEqual([])
    expect(selection.selectedRepos).toEqual([])
    expect(selection.hasRepoFilter).toBe(false)
  })

  it('shows a group listed once per host a single time and roots orphaned children', () => {
    const selection = buildProjectFilterSelection({
      repos: REPOS,
      projectGroups: [
        ...GROUPS,
        { ...group('tools'), executionHostId: 'ssh:box' } as ProjectGroup,
        group('orphan', { parentGroupId: 'missing-parent', tabOrder: 5 })
      ],
      filterRepoIds: [],
      filterGroupIds: []
    })
    expect(selection.availableGroups.map((option) => [option.group.id, option.depth])).toEqual([
      ['perc', 0],
      ['services', 1],
      ['internal', 2],
      ['lambdas', 1],
      ['tools', 0],
      ['orphan', 0]
    ])
  })
})
