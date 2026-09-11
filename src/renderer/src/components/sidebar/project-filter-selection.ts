import type { ProjectGroup } from '../../../../shared/project-group-types'
import type { Repo } from '../../../../shared/repo-types'
import {
  EMPTY_PROJECT_GROUP_FILTER_REPO_ID,
  resolveEffectiveFilterRepoIds
} from './project-filter-resolution'

export type ProjectGroupFilterOption = {
  group: ProjectGroup
  /** Nesting level under the roots, mirroring the sidebar's header indentation. */
  depth: number
  /** Projects in the group and its subgroups. */
  repoCount: number
}

export type ProjectFilterSelection = {
  /** Selected groups in sidebar tree order. */
  selectedGroups: ProjectGroupFilterOption[]
  /** Explicit project picks, in catalog order. */
  selectedRepos: Repo[]
  /** Groups still selectable: neither selected nor under a selected ancestor. */
  availableGroups: ProjectGroupFilterOption[]
  /** Projects not yet admitted by a pick or a selected group. */
  availableRepos: Repo[]
  /** Distinct projects the filter admits. */
  effectiveRepoCount: number
  hasRepoFilter: boolean
}

type ProjectFilterSelectionInput = {
  repos: readonly Repo[]
  projectGroups: readonly ProjectGroup[]
  filterRepoIds: readonly string[]
  filterGroupIds: readonly string[]
}

function compareGroupsForDisplay(left: ProjectGroup, right: ProjectGroup): number {
  return left.tabOrder - right.tabOrder || left.name.localeCompare(right.name)
}

/** Picker/chip model for the Projects filter; stale ids are dropped so they never inflate counts. */
export function buildProjectFilterSelection(
  input: ProjectFilterSelectionInput
): ProjectFilterSelection {
  const { repos, projectGroups, filterRepoIds, filterGroupIds } = input
  // Why: the same group id can be listed once per host; the picker shows it once.
  const groupsById = new Map<string, ProjectGroup>()
  for (const group of projectGroups) {
    if (!groupsById.has(group.id)) {
      groupsById.set(group.id, group)
    }
  }
  const childrenByParentId = new Map<string | null, ProjectGroup[]>()
  for (const group of groupsById.values()) {
    const parentId =
      group.parentGroupId && groupsById.has(group.parentGroupId) ? group.parentGroupId : null
    const siblings = childrenByParentId.get(parentId) ?? []
    siblings.push(group)
    childrenByParentId.set(parentId, siblings)
  }
  for (const siblings of childrenByParentId.values()) {
    siblings.sort(compareGroupsForDisplay)
  }
  const directRepoCountByGroupId = new Map<string, number>()
  for (const repo of repos) {
    if (repo.projectGroupId) {
      directRepoCountByGroupId.set(
        repo.projectGroupId,
        (directRepoCountByGroupId.get(repo.projectGroupId) ?? 0) + 1
      )
    }
  }

  const selectedGroupIds = new Set(filterGroupIds)
  const selectedGroups: ProjectGroupFilterOption[] = []
  const availableGroups: ProjectGroupFilterOption[] = []
  const visit = (group: ProjectGroup, depth: number, underSelected: boolean): number => {
    const isSelected = selectedGroupIds.has(group.id)
    const option: ProjectGroupFilterOption = { group, depth, repoCount: 0 }
    if (isSelected) {
      selectedGroups.push(option)
    } else if (!underSelected) {
      availableGroups.push(option)
    }
    let repoCount = directRepoCountByGroupId.get(group.id) ?? 0
    for (const child of childrenByParentId.get(group.id) ?? []) {
      repoCount += visit(child, depth + 1, underSelected || isSelected)
    }
    option.repoCount = repoCount
    return repoCount
  }
  for (const root of childrenByParentId.get(null) ?? []) {
    visit(root, 0, false)
  }

  const effectiveRepoIds = new Set(
    resolveEffectiveFilterRepoIds({ filterRepoIds, filterGroupIds, repos, projectGroups })
  )
  effectiveRepoIds.delete(EMPTY_PROJECT_GROUP_FILTER_REPO_ID)
  const explicitRepoIds = new Set(filterRepoIds)
  const selectedRepos = repos.filter((repo) => explicitRepoIds.has(repo.id))
  const availableRepos = repos.filter((repo) => !effectiveRepoIds.has(repo.id))
  return {
    selectedGroups,
    selectedRepos,
    availableGroups,
    availableRepos,
    effectiveRepoCount: repos.length - availableRepos.length,
    hasRepoFilter: selectedGroups.length > 0 || selectedRepos.length > 0
  }
}
