import { toast } from 'sonner'
import { useAppStore } from '../../store'
import { translate } from '@/i18n/i18n'
import type { TabWorkspaceMove } from '../../store/slices/tab-workspace-move'

/** Why main is told explicitly: the runtime attributes a live PTY to a workspace,
 *  and `resolveTerminalPane` rejects a pane whose workspace disagrees with the
 *  caller's. Waiting for the next graph publication would leave the moved tab
 *  unaddressable — and a tab parked in a workspace the user never opens would
 *  stay stale indefinitely. */
async function rehomeHostTerminalBinding(move: TabWorkspaceMove): Promise<void> {
  if (move.tab.contentType !== 'terminal') {
    return
  }
  try {
    await window.api.pty.rehomeTabWorktree?.(move.tab.entityId, move.targetWorktreeId)
  } catch (error) {
    console.warn('[tab-move-to-workspace] host rehome failed', error)
  }
}

function reportRetainedCwd(move: TabWorkspaceMove, targetLabel: string): void {
  if (!move.retainedCwd) {
    toast.success(
      translate('components.tab.bar.tabMoveToWorkspace.moved', 'Tab moved to {{workspace}}', {
        workspace: targetLabel
      })
    )
    return
  }
  // Why: a running shell cannot be re-rooted, so say where it still runs instead
  // of letting the destination card imply the tab followed it into a new folder.
  toast.success(
    translate('components.tab.bar.tabMoveToWorkspace.moved', 'Tab moved to {{workspace}}', {
      workspace: targetLabel
    }),
    {
      description: translate(
        'components.tab.bar.tabMoveToWorkspace.keepsWorkingDirectory',
        'The running process keeps its working directory: {{path}}',
        { path: move.retainedCwd }
      )
    }
  )
}

export function moveTabToWorkspace(args: {
  unifiedTabId: string
  targetWorktreeId: string
  targetLabel: string
}): boolean {
  const move = useAppStore
    .getState()
    .moveUnifiedTabToWorkspace(args.unifiedTabId, args.targetWorktreeId)
  if (!move) {
    return false
  }
  void rehomeHostTerminalBinding(move)
  reportRetainedCwd(move, args.targetLabel)
  return true
}
