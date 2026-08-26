import React, { useCallback, useMemo, useState } from 'react'
import {
  CalendarClock,
  FolderPlus,
  GitBranch,
  GitCommitHorizontal,
  ListFilter,
  Moon,
  SquareTerminal
} from 'lucide-react'
import { useAppStore } from '@/store'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { useProjectFilterSelection } from './use-project-filter-selection'
import { FilterToggleRow } from './FilterToggleRow'
import { SidebarFilterProjectPicker } from './SidebarFilterProjectPicker'
import { useShortcutLabel } from '@/hooks/useShortcutLabel'
import { DEFAULT_SHOW_SLEEPING_WORKSPACES } from '../../../../shared/constants'
import { isSleepingSweepExemptionNarrowingList } from './visible-worktrees'
import { translate } from '@/i18n/i18n'
import { SidebarScopedProjectMenuItems } from './SidebarScopedProjectMenuItems'
import { useWindowScopeProject } from './use-window-scope-project'
import {
  isProjectFilterActive,
  resetProjectFilterToWindowBaseline
} from './window-scope-project-filter'

type SidebarFilterProps = {
  preserveWorkspaceBoardOpen?: boolean
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left'
  contentSide?: 'top' | 'right' | 'bottom' | 'left'
  onMenuOpenChange?: (open: boolean) => void
}

const SidebarFilter = React.memo(function SidebarFilter({
  preserveWorkspaceBoardOpen = false,
  tooltipSide = 'bottom',
  contentSide = 'right',
  onMenuOpenChange
}: SidebarFilterProps) {
  const showSleepingWorkspaces = useAppStore((s) => s.showSleepingWorkspaces)
  const setShowSleepingWorkspaces = useAppStore((s) => s.setShowSleepingWorkspaces)
  // Surface the user-assigned shortcut here so the filter menu doubles as its
  // discovery point ('Unassigned' until they bind one in Settings → Shortcuts).
  const sleepingShortcut = useShortcutLabel('sidebar.sleepingWorkspaces.toggle')
  const hideDefaultBranchWorkspace = useAppStore((s) => s.hideDefaultBranchWorkspace)
  const setHideDefaultBranchWorkspace = useAppStore((s) => s.setHideDefaultBranchWorkspace)
  const hideAutomationGeneratedWorkspaces = useAppStore((s) => s.hideAutomationGeneratedWorkspaces)
  const setHideAutomationGeneratedWorkspaces = useAppStore(
    (s) => s.setHideAutomationGeneratedWorkspaces
  )
  const hideCliCreatedWorkspaces = useAppStore((s) => s.hideCliCreatedWorkspaces)
  const setHideCliCreatedWorkspaces = useAppStore((s) => s.setHideCliCreatedWorkspaces)
  const hideDetachedHeadWorkspaces = useAppStore((s) => s.hideDetachedHeadWorkspaces)
  const setHideDetachedHeadWorkspaces = useAppStore((s) => s.setHideDetachedHeadWorkspaces)
  const alwaysShowDefaultBranchWorkspace = useAppStore((s) => s.alwaysShowDefaultBranchWorkspace)
  const setAlwaysShowDefaultBranchWorkspace = useAppStore(
    (s) => s.setAlwaysShowDefaultBranchWorkspace
  )
  const filterRepoIds = useAppStore((s) => s.filterRepoIds)
  const setFilterRepoIds = useAppStore((s) => s.setFilterRepoIds)
  const filterGroupIds = useAppStore((s) => s.filterGroupIds)
  const setFilterGroupIds = useAppStore((s) => s.setFilterGroupIds)
  const repos = useAppStore((s) => s.repos)
  const addRepo = useAppStore((s) => s.addRepo)
  const scopedProject = useWindowScopeProject()

  const [open, setOpen] = useState(false)

  const handleOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next)
      onMenuOpenChange?.(next)
    },
    [onMenuOpenChange]
  )

  const handleToggleRepo = useCallback(
    (repoId: string) => {
      setFilterRepoIds(
        filterRepoIds.includes(repoId)
          ? filterRepoIds.filter((id) => id !== repoId)
          : [...filterRepoIds, repoId]
      )
    },
    [filterRepoIds, setFilterRepoIds]
  )

  const canFilterRepos = repos.length > 1
  const projectFilter = useProjectFilterSelection()
  const selectedRepoIdSet = useMemo(
    () => new Set(projectFilter.selectedRepos.map((repo) => repo.id)),
    [projectFilter.selectedRepos]
  )
  const selectedCount = selectedRepoIdSet.size
  // Why: groups picked in the sidebar's Projects filter hide cards here too — except the group a
  // project window is bound to, which is that window's baseline rather than a filter.
  const hasRepoFilter = isProjectFilterActive({
    windowScope: scopedProject.scope,
    filterRepoIds,
    filterGroupIds
  })
  const hasSleepingFilter = showSleepingWorkspaces !== DEFAULT_SHOW_SLEEPING_WORKSPACES
  // Why counted: turning the exemption off is the only way that row narrows the
  // list — but only while its parent row is on, which is also when it renders.
  const hasSleepingExemptionFilter = isSleepingSweepExemptionNarrowingList(
    showSleepingWorkspaces,
    alwaysShowDefaultBranchWorkspace
  )
  const hasAnyFilter =
    hasSleepingFilter ||
    hideDefaultBranchWorkspace ||
    hideAutomationGeneratedWorkspaces ||
    hideCliCreatedWorkspaces ||
    hideDetachedHeadWorkspaces ||
    hasSleepingExemptionFilter ||
    hasRepoFilter
  const activeFilterCount =
    (hasSleepingFilter ? 1 : 0) +
    (hideDefaultBranchWorkspace ? 1 : 0) +
    (hideAutomationGeneratedWorkspaces ? 1 : 0) +
    (hideCliCreatedWorkspaces ? 1 : 0) +
    (hideDetachedHeadWorkspaces ? 1 : 0) +
    (hasSleepingExemptionFilter ? 1 : 0) +
    selectedCount +
    (scopedProject.scope ? 0 : projectFilter.selectedGroups.length)

  const allSelected = canFilterRepos && selectedCount === repos.length

  // Why: "clear" means the window's baseline — empty in a free window, the bound project in a scoped one.
  const clearRepos = useCallback(
    () =>
      resetProjectFilterToWindowBaseline({
        windowScope: scopedProject.scope,
        filterRepoIds,
        filterGroupIds,
        setFilterRepoIds,
        setFilterGroupIds
      }),
    [scopedProject.scope, filterRepoIds, filterGroupIds, setFilterRepoIds, setFilterGroupIds]
  )

  const clearAll = useCallback(() => {
    setShowSleepingWorkspaces(DEFAULT_SHOW_SLEEPING_WORKSPACES)
    setHideDefaultBranchWorkspace(false)
    setHideAutomationGeneratedWorkspaces(false)
    setHideCliCreatedWorkspaces(false)
    setHideDetachedHeadWorkspaces(false)
    setAlwaysShowDefaultBranchWorkspace(true)
    clearRepos()
  }, [
    setShowSleepingWorkspaces,
    setHideDefaultBranchWorkspace,
    setHideAutomationGeneratedWorkspaces,
    setHideCliCreatedWorkspaces,
    setHideDetachedHeadWorkspaces,
    setAlwaysShowDefaultBranchWorkspace,
    clearRepos
  ])

  // Why: derive ids from the live repos list at click time so a repo added
  // while the popover is open is included immediately.
  const selectAllRepos = useCallback(() => {
    setFilterRepoIds(repos.map((r) => r.id))
  }, [repos, setFilterRepoIds])

  return (
    <DropdownMenu modal={false} open={open} onOpenChange={handleOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              type="button"
              aria-label={
                hasAnyFilter
                  ? translate(
                      'auto.components.sidebar.SidebarFilter.75405270ed',
                      'Edit filters ({{value0}} active)',
                      { value0: activeFilterCount }
                    )
                  : translate(
                      'auto.components.sidebar.SidebarFilter.f506a1262a',
                      'Filter workspaces'
                    )
              }
              className="relative text-muted-foreground"
              data-workspace-board-preserve-open={preserveWorkspaceBoardOpen ? '' : undefined}
            >
              <ListFilter className="size-3.5" strokeWidth={2.25} />
              {hasAnyFilter && (
                // Why: the only at-a-glance affordance that filters are
                // applied — without it the list can silently hide workspaces.
                <span
                  aria-hidden
                  className="absolute -top-0.5 -right-0.5 flex h-3 min-w-3 items-center justify-center rounded-full bg-primary px-0.5 text-[9px] font-medium leading-none text-primary-foreground"
                >
                  {activeFilterCount > 9 ? '9+' : activeFilterCount}
                </span>
              )}
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side={tooltipSide} sideOffset={6}>
          {hasAnyFilter
            ? translate('auto.components.sidebar.SidebarFilter.ee240a39eb', 'Edit filters')
            : translate('auto.components.sidebar.SidebarFilter.f506a1262a', 'Filter workspaces')}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        side={contentSide}
        align="start"
        sideOffset={8}
        className="w-72"
        data-workspace-board-preserve-open={preserveWorkspaceBoardOpen ? '' : undefined}
      >
        <FilterToggleRow
          icon={<Moon className="size-3.5" />}
          label={translate('auto.components.sidebar.SidebarFilter.638a2d221d', 'Hide sleeping')}
          checked={!showSleepingWorkspaces}
          onChange={(hideSleeping) => setShowSleepingWorkspaces(!hideSleeping)}
          shortcutLabel={sleepingShortcut === 'Unassigned' ? undefined : sleepingShortcut}
        />
        {/* Why gated: the exemption only has an effect while sleeping workspaces
            are being swept, so it stays hidden until its parent row is on. */}
        {!showSleepingWorkspaces && (
          <FilterToggleRow
            indented
            icon={<GitBranch className="size-3.5" />}
            label={translate(
              'auto.components.sidebar.SidebarFilter.keepDefaultBranch',
              'Except default branch'
            )}
            ariaLabel={translate(
              'auto.components.sidebar.SidebarFilter.keepDefaultBranchAria',
              'Keep the default branch visible while hiding sleeping workspaces'
            )}
            checked={alwaysShowDefaultBranchWorkspace}
            onChange={setAlwaysShowDefaultBranchWorkspace}
          />
        )}
        <FilterToggleRow
          icon={<GitBranch className="size-3.5" />}
          label={translate(
            'auto.components.sidebar.SidebarFilter.e5cb32a898',
            'Hide default branch'
          )}
          checked={hideDefaultBranchWorkspace}
          onChange={setHideDefaultBranchWorkspace}
        />
        <FilterToggleRow
          icon={<CalendarClock className="size-3.5" />}
          label={translate(
            'auto.components.sidebar.SidebarFilter.automationCreated',
            'Hide automation-created'
          )}
          checked={hideAutomationGeneratedWorkspaces}
          onChange={setHideAutomationGeneratedWorkspaces}
        />
        <FilterToggleRow
          icon={<SquareTerminal className="size-3.5" />}
          label={translate('auto.components.sidebar.SidebarFilter.cliCreated', 'Hide CLI-created')}
          checked={hideCliCreatedWorkspaces}
          onChange={setHideCliCreatedWorkspaces}
        />
        <FilterToggleRow
          icon={<GitCommitHorizontal className="size-3.5" />}
          label={translate(
            'auto.components.sidebar.SidebarFilter.detachedHead',
            'Hide detached HEAD'
          )}
          checked={hideDetachedHeadWorkspaces}
          onChange={setHideDetachedHeadWorkspaces}
        />

        {scopedProject.scope ? (
          <>
            <DropdownMenuSeparator />
            <SidebarScopedProjectMenuItems project={scopedProject} />
          </>
        ) : null}
        {canFilterRepos && !scopedProject.scope && (
          <>
            <DropdownMenuSeparator />
            <SidebarFilterProjectPicker
              repos={repos}
              selectedRepoIdSet={selectedRepoIdSet}
              effectiveRepoCount={projectFilter.effectiveRepoCount}
              hasRepoFilter={hasRepoFilter}
              allSelected={allSelected}
              onToggleRepo={handleToggleRepo}
              onSelectAll={selectAllRepos}
              onClear={clearRepos}
            />
          </>
        )}

        <DropdownMenuSeparator />
        {/* Why: "Add project" stays visible regardless of project count so users
            can recover from the 0/1-project state where the project section is
            hidden. Reset sits beside it only when a filter is active. */}
        <div className="flex items-center justify-between gap-1 px-1 py-1">
          {hasAnyFilter ? (
            <button
              type="button"
              onClick={clearAll}
              className="rounded-[5px] px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {translate('auto.components.sidebar.SidebarFilter.92a23e6d07', 'Reset filters')}
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={() => addRepo()}
            className="inline-flex items-center gap-1.5 rounded-[5px] px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <FolderPlus className="size-3.5" />
            {translate('auto.components.sidebar.SidebarFilter.e3b3898218', 'Add project')}
          </button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
})

export default SidebarFilter
