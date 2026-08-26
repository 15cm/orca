import type { ProjectGroup } from '../../../../shared/project-group-types'
import type { Repo } from '../../../../shared/repo-types'
import { getProjectGroupSubtreeIds } from '../../../../shared/project-groups'
import type { WindowScope } from '../../../../shared/window-scope'

/**
 * The sidebar's project filter has two persisted halves — explicit project picks
 * (`filterRepoIds`) and project groups (`filterGroupIds`) — but every consumer
 * reads one flat list of repo ids. This module is the only place that flattens
 * them, so group membership changes (a project added to a filtered group) are
 * picked up everywhere without touching the consumers.
 */

export type ProjectFilterInputs = {
  filterRepoIds: readonly string[]
  filterGroupIds: readonly string[]
  repos: readonly Pick<Repo, 'id' | 'projectGroupId'>[]
  projectGroups: readonly Pick<ProjectGroup, 'id' | 'parentGroupId'>[]
  /** Project group this window is bound to (shared/window-scope); absent or null for a free window. */
  windowScope?: WindowScope | null
}

/**
 * Stands in for "a selected group with no member projects" in the effective list.
 * Why: consumers read an empty list as "no project filter", so a filter that
 * legitimately matches nothing needs one id no repo can carry to stay active.
 */
export const EMPTY_PROJECT_GROUP_FILTER_REPO_ID = 'project-group-filter:no-projects'

/** Ids of the selected groups plus all their descendants; unknown group ids are skipped. */
export function getSelectedProjectGroupSubtreeIds(
  projectGroups: ProjectFilterInputs['projectGroups'],
  filterGroupIds: readonly string[]
): Set<string> {
  const knownGroupIds = new Set(projectGroups.map((group) => group.id))
  const subtreeIds = new Set<string>()
  for (const groupId of filterGroupIds) {
    if (!knownGroupIds.has(groupId) || subtreeIds.has(groupId)) {
      continue
    }
    for (const id of getProjectGroupSubtreeIds(projectGroups, groupId)) {
      subtreeIds.add(id)
    }
  }
  return subtreeIds
}

/**
 * Folder workspaces hang off project groups rather than projects, so a group
 * filter scopes them too — otherwise picking one group still leaves every other
 * group's terminal cards on screen. A project-only filter leaves them alone: a
 * folder workspace is not a project, so no project pick can name one.
 */
export function filterFolderWorkspacesForSelectedGroups<T extends { projectGroupId: string }>(
  folderWorkspaces: readonly T[],
  projectGroups: ProjectFilterInputs['projectGroups'],
  filterGroupIds: readonly string[]
): readonly T[] {
  if (filterGroupIds.length === 0) {
    return folderWorkspaces
  }
  const subtreeIds = getSelectedProjectGroupSubtreeIds(projectGroups, filterGroupIds)
  if (subtreeIds.size === 0) {
    return folderWorkspaces
  }
  return folderWorkspaces.filter((workspace) => subtreeIds.has(workspace.projectGroupId))
}

export function resolveEffectiveFilterRepoIds(input: ProjectFilterInputs): readonly string[] {
  if (input.filterGroupIds.length === 0) {
    return input.filterRepoIds
  }
  const subtreeIds = getSelectedProjectGroupSubtreeIds(input.projectGroups, input.filterGroupIds)
  // Why fail-open only for a free window: at launch the filter is applied before any group
  // catalog exists, so an unresolved id must not blank the sidebar. A scoped window is bound
  // to exactly that group and shows nothing (the "loading project" state) until it resolves.
  if (subtreeIds.size === 0 && !input.windowScope) {
    return input.filterRepoIds
  }
  const repoIds = new Set(input.filterRepoIds)
  for (const repo of input.repos) {
    if (repo.projectGroupId && subtreeIds.has(repo.projectGroupId)) {
      repoIds.add(repo.id)
    }
  }
  return repoIds.size === 0 ? [EMPTY_PROJECT_GROUP_FILTER_REPO_ID] : [...repoIds]
}

type ResolutionCache = { inputs: ProjectFilterInputs; result: readonly string[] }
let resolutionCache: ResolutionCache | null = null

function sameInputs(left: ProjectFilterInputs, right: ProjectFilterInputs): boolean {
  return (
    left.filterRepoIds === right.filterRepoIds &&
    left.filterGroupIds === right.filterGroupIds &&
    left.repos === right.repos &&
    left.projectGroups === right.projectGroups &&
    (left.windowScope ?? null) === (right.windowScope ?? null)
  )
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

/**
 * Store selector for the flattened filter. Returns `filterRepoIds` itself while
 * no group is selected, and otherwise a list whose identity only changes when
 * its contents do — repo catalogs refresh often, and the sidebar's row pipeline
 * memoizes on this array.
 */
export function selectEffectiveFilterRepoIds(state: ProjectFilterInputs): readonly string[] {
  if (state.filterGroupIds.length === 0) {
    return state.filterRepoIds
  }
  if (resolutionCache && sameInputs(resolutionCache.inputs, state)) {
    return resolutionCache.result
  }
  const next = resolveEffectiveFilterRepoIds(state)
  const result =
    resolutionCache && sameIds(resolutionCache.result, next) ? resolutionCache.result : next
  // Why: cache the four inputs, not the store snapshot, so replaced snapshots can be collected.
  resolutionCache = {
    inputs: {
      filterRepoIds: state.filterRepoIds,
      filterGroupIds: state.filterGroupIds,
      repos: state.repos,
      projectGroups: state.projectGroups,
      windowScope: state.windowScope ?? null
    },
    result
  }
  return result
}

type ProjectFilterRevealState = ProjectFilterInputs & {
  setFilterRepoIds: (ids: string[]) => void
  setFilterGroupIds: (ids: string[]) => void
}

/** Clears the project filter when it would hide `repoId`; reveal paths need the card rendered. */
export function clearProjectFilterHidingRepo(
  state: ProjectFilterRevealState,
  repoId: string
): void {
  const effectiveRepoIds = selectEffectiveFilterRepoIds(state)
  if (effectiveRepoIds.length === 0 || effectiveRepoIds.includes(repoId)) {
    return
  }
  // Why: a scoped window widens to admit the repo instead of dropping its project. Containment,
  // not the fix — the CLI, notifications and mobile "open in desktop" still land in whichever
  // window handles them; routing a reveal to the right project window is a later phase.
  if (state.windowScope) {
    state.setFilterRepoIds([...state.filterRepoIds, repoId])
    return
  }
  if (state.filterRepoIds.length > 0) {
    state.setFilterRepoIds([])
  }
  if (state.filterGroupIds.length > 0) {
    state.setFilterGroupIds([])
  }
}

/**
 * Drops filter ids for the groups a delete cascade removed. Only the removed ids
 * go: an id for a group on a host whose catalog has not loaded yet is still valid.
 */
export function dropDeletedProjectGroupFilterIds(
  filterGroupIds: readonly string[],
  previousGroups: readonly Pick<ProjectGroup, 'id'>[],
  nextGroups: readonly Pick<ProjectGroup, 'id'>[]
): readonly string[] {
  if (filterGroupIds.length === 0) {
    return filterGroupIds
  }
  const remainingGroupIds = new Set(nextGroups.map((group) => group.id))
  const deletedGroupIds = new Set(
    previousGroups.map((group) => group.id).filter((id) => !remainingGroupIds.has(id))
  )
  return filterGroupIds.some((id) => deletedGroupIds.has(id))
    ? filterGroupIds.filter((id) => !deletedGroupIds.has(id))
    : filterGroupIds
}
