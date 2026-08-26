import React, { useCallback, useMemo } from 'react'
import { FolderTree, Unlink } from 'lucide-react'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger
} from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import { buildProjectFilterSelection } from './project-filter-selection'
import type { WindowScopeProject } from './use-window-scope-project'
import { PROJECT_GROUP_HEADER_INDENT } from './worktree-list/rows/indentation'

// Why: matches the item's `px-2` so depth 0 sits flush with the other entries.
const MENU_ITEM_PADDING_LEFT = 8

export function getScopedProjectDisplayName(project: WindowScopeProject): string {
  return (
    project.group?.name ??
    translate(
      'auto.components.sidebar.SidebarScopedProjectMenuItems.loadingProject',
      'Loading project…'
    )
  )
}

/**
 * Replaces the multi-pick project filter in a window bound to a project group. The filter is
 * derived from the scope, so the only moves are re-binding the window to another group or
 * releasing it — never a picker that appears to work and then forgets on the next hydration.
 */
export function SidebarScopedProjectMenuItems({
  project
}: {
  project: WindowScopeProject
}): React.JSX.Element {
  const repos = useAppStore((s) => s.repos)
  const projectGroups = useAppStore((s) => s.projectGroups)
  const bindWindowToProjectGroup = useAppStore((s) => s.bindWindowToProjectGroup)
  const releaseWindowScope = useAppStore((s) => s.releaseWindowScope)
  // Why: no picks, so every group lands in `availableGroups` in sidebar tree order.
  const groups = useMemo(
    () =>
      buildProjectFilterSelection({
        repos,
        projectGroups,
        filterRepoIds: [],
        filterGroupIds: []
      }).availableGroups,
    [repos, projectGroups]
  )
  const currentGroupId = project.scope?.projectGroupId ?? null

  const changeProject = useCallback(
    async (projectGroupId: string) => {
      const result = await bindWindowToProjectGroup(projectGroupId)
      if (result.status === 'revealed-existing') {
        toast.info(
          translate(
            'auto.components.sidebar.SidebarScopedProjectMenuItems.alreadyOpen',
            'That project is already open in another window'
          )
        )
      }
    },
    [bindWindowToProjectGroup]
  )

  return (
    <>
      <div className="flex items-center gap-1.5 px-2 py-1 text-[11px] text-muted-foreground">
        <FolderTree className="size-3 shrink-0" />
        <span className="font-semibold">
          {translate(
            'auto.components.sidebar.SidebarScopedProjectMenuItems.projectLabel',
            'Project'
          )}
        </span>
        <span
          className={
            project.group
              ? 'min-w-0 truncate font-medium text-foreground'
              : 'min-w-0 truncate italic'
          }
        >
          {getScopedProjectDisplayName(project)}
        </span>
      </div>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          {translate(
            'auto.components.sidebar.SidebarScopedProjectMenuItems.changeProject',
            'Change project'
          )}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="scrollbar-sleek max-h-72 overflow-y-auto">
          {groups.map(({ group, depth, repoCount }) => (
            <DropdownMenuItem
              key={group.id}
              disabled={group.id === currentGroupId}
              data-scoped-project-target={group.id}
              // Why: nested names repeat across subtrees; mirror the sidebar indent so the path is readable.
              style={{
                paddingLeft: MENU_ITEM_PADDING_LEFT + depth * PROJECT_GROUP_HEADER_INDENT
              }}
              onSelect={() => void changeProject(group.id)}
            >
              <span className="max-w-48 truncate">{group.name}</span>
              <span className="ml-auto pl-3 text-[11px] text-muted-foreground">{repoCount}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuItem onSelect={() => void releaseWindowScope()}>
        <Unlink className="size-3.5" />
        {translate('auto.components.sidebar.SidebarScopedProjectMenuItems.freeMode', 'Free mode')}
      </DropdownMenuItem>
    </>
  )
}
