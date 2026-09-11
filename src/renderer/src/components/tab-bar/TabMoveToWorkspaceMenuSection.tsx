import { FolderInput, FolderSymlink } from 'lucide-react'
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger
} from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { getTabWorkspaceMoveTargets } from './tab-workspace-move-targets'
import { moveTabToWorkspace } from './tab-move-to-workspace'
import { TAB_CONTEXT_SUBMENU_CONTENT_CLASS } from './tab-context-menu-sizing'

/** Submenu that rehomes the tab to another workspace on the same execution host.
 *  Renders nothing when there is nowhere to move it — same rule the sibling
 *  "Move Tab to Split" section follows. */
export function TabMoveToWorkspaceMenuSection({
  unifiedTabId,
  trailingSeparator = false
}: {
  unifiedTabId: string
  trailingSeparator?: boolean
}): React.JSX.Element | null {
  const targets = getTabWorkspaceMoveTargets(unifiedTabId)
  if (targets.length === 0) {
    return null
  }

  return (
    <>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger className="[&>svg:last-child]:size-3.5">
          <FolderInput className="size-3.5 shrink-0" />
          {translate(
            'components.tab.bar.TabMoveToWorkspaceMenuSection.moveToWorkspace',
            'Move to Workspace'
          )}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent
          className={cn(
            'max-h-80 overflow-y-auto scrollbar-sleek',
            TAB_CONTEXT_SUBMENU_CONTENT_CLASS
          )}
        >
          {targets.map((target) => (
            <DropdownMenuItem
              key={target.worktreeId}
              onSelect={() => {
                moveTabToWorkspace({
                  unifiedTabId,
                  targetWorktreeId: target.worktreeId,
                  targetLabel: target.label
                })
              }}
            >
              <FolderSymlink className="size-3.5 shrink-0" />
              {target.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      {trailingSeparator ? <DropdownMenuSeparator /> : null}
    </>
  )
}
