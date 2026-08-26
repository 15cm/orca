import React, { useCallback } from 'react'
import { useAppStore } from '@/store'
import {
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger
} from '@/components/ui/dropdown-menu'
import { SidebarProjectFilterPanel } from './SidebarProjectFilterPanel'
import type { ProjectFilterSelection } from './project-filter-selection'
import { useProjectFilterSelection } from './use-project-filter-selection'
import { translate } from '@/i18n/i18n'
import {
  getScopedProjectDisplayName,
  SidebarScopedProjectMenuItems
} from './SidebarScopedProjectMenuItems'
import { useWindowScopeProject } from './use-window-scope-project'
import { resetProjectFilterToWindowBaseline } from './window-scope-project-filter'

function getProjectFilterVisibilityLabel(selection: ProjectFilterSelection): string {
  const { selectedGroups, selectedRepos, effectiveRepoCount } = selection
  if (selectedGroups.length === 0 && selectedRepos.length === 0) {
    return translate(
      'auto.components.sidebar.SidebarRepositoryFilterSection.allProjects',
      'All projects'
    )
  }
  // Why: a lone pick names itself; any combination reads as the projects it admits.
  if (selectedGroups.length === 1 && selectedRepos.length === 0) {
    return selectedGroups[0]?.group.name ?? 'Projects'
  }
  if (selectedGroups.length === 0 && selectedRepos.length === 1) {
    return selectedRepos[0]?.displayName ?? 'Projects'
  }
  return translate(
    'auto.components.sidebar.SidebarRepositoryFilterSection.selectedProjectsCount',
    '{{value0}} projects',
    { value0: effectiveRepoCount }
  )
}

type SidebarRepositoryFilterSectionProps = {
  preserveWorkspaceBoardOpen?: boolean
  filterRepoIds?: readonly string[]
  setFilterRepoIds?: (ids: readonly string[]) => void
}

const SidebarRepositoryFilterSection = React.memo(function SidebarRepositoryFilterSection({
  preserveWorkspaceBoardOpen = false,
  filterRepoIds: filterRepoIdsProp,
  setFilterRepoIds: setFilterRepoIdsProp
}: SidebarRepositoryFilterSectionProps) {
  const storeFilterRepoIds = useAppStore((s) => s.filterRepoIds)
  const storeSetFilterRepoIds = useAppStore((s) => s.setFilterRepoIds)
  const filterRepoIds = filterRepoIdsProp ?? storeFilterRepoIds
  const setFilterRepoIds = setFilterRepoIdsProp ?? storeSetFilterRepoIds
  const filterGroupIds = useAppStore((s) => s.filterGroupIds)
  const setFilterGroupIds = useAppStore((s) => s.setFilterGroupIds)
  const repos = useAppStore((s) => s.repos)
  const scopedProject = useWindowScopeProject()
  const selection = useProjectFilterSelection(
    filterRepoIdsProp ? { filterRepoIds: filterRepoIdsProp, filterGroupIds: [] } : undefined
  )

  const canFilterRepos = repos.length > 1
  const { hasRepoFilter, effectiveRepoCount } = selection
  const visibilityLabel = getProjectFilterVisibilityLabel(selection)

  const handleSelectRepo = useCallback(
    (repoId: string) => {
      if (!filterRepoIds.includes(repoId)) {
        setFilterRepoIds([...filterRepoIds, repoId])
      }
    },
    [filterRepoIds, setFilterRepoIds]
  )
  const handleRemoveRepo = useCallback(
    (repoId: string) => setFilterRepoIds(filterRepoIds.filter((id) => id !== repoId)),
    [filterRepoIds, setFilterRepoIds]
  )
  const handleSelectGroup = useCallback(
    (groupId: string) => {
      if (!filterGroupIds.includes(groupId)) {
        setFilterGroupIds([...filterGroupIds, groupId])
      }
    },
    [filterGroupIds, setFilterGroupIds]
  )
  const handleRemoveGroup = useCallback(
    (groupId: string) => setFilterGroupIds(filterGroupIds.filter((id) => id !== groupId)),
    [filterGroupIds, setFilterGroupIds]
  )
  const clearProjectFilter = useCallback(
    () =>
      resetProjectFilterToWindowBaseline({
        windowScope: scopedProject.scope,
        filterRepoIds,
        filterGroupIds,
        setFilterRepoIds,
        setFilterGroupIds
      }),
    [scopedProject.scope, filterGroupIds, filterRepoIds, setFilterGroupIds, setFilterRepoIds]
  )

  if (scopedProject.scope) {
    return (
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <span className="flex flex-1 items-center justify-between gap-3">
            <span>
              {translate(
                'auto.components.sidebar.SidebarRepositoryFilterSection.projectRow',
                'Project'
              )}
            </span>
            <span className="min-w-0 truncate text-[11px] font-medium text-muted-foreground">
              {getScopedProjectDisplayName(scopedProject)}
            </span>
          </span>
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="w-64">
          <SidebarScopedProjectMenuItems project={scopedProject} />
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    )
  }

  if (!canFilterRepos) {
    return null
  }

  // Why: same Sort-by-style single row as Hosts — label left, current value
  // right; search/selection lives in the nested panel only.
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <span className="flex flex-1 items-center justify-between gap-3">
          <span>
            {translate(
              'auto.components.sidebar.SidebarRepositoryFilterSection.7679f0c268',
              'Projects'
            )}
          </span>
          <span className="min-w-0 truncate text-[11px] font-medium text-muted-foreground">
            {visibilityLabel}
          </span>
        </span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent
        className="w-64"
        data-workspace-board-preserve-open={preserveWorkspaceBoardOpen ? '' : undefined}
      >
        <div className="flex items-center justify-between px-2 py-1">
          <span className="text-[11px] font-semibold text-muted-foreground">
            {translate(
              'auto.components.sidebar.SidebarRepositoryFilterSection.7679f0c268',
              'Projects'
            )}
            {hasRepoFilter && (
              <span className="ml-1.5 font-medium text-foreground">· {effectiveRepoCount}</span>
            )}
          </span>
          <button
            type="button"
            onClick={clearProjectFilter}
            className="rounded-full px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-40 disabled:hover:bg-transparent"
            disabled={!hasRepoFilter}
          >
            {translate(
              'auto.components.sidebar.SidebarRepositoryFilterSection.d3a9c4cea1',
              'Clear'
            )}
          </button>
        </div>

        <SidebarProjectFilterPanel
          availableRepos={selection.availableRepos}
          availableGroups={selection.availableGroups}
          selectedRepos={selection.selectedRepos}
          selectedGroups={selection.selectedGroups}
          hasRepoFilter={hasRepoFilter}
          onSelectRepo={handleSelectRepo}
          onRemoveRepo={handleRemoveRepo}
          onSelectGroup={handleSelectGroup}
          onRemoveGroup={handleRemoveGroup}
        />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
})

export default SidebarRepositoryFilterSection
