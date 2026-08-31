import type { AppState } from '../store/types'
import { partitionWorkspaceSessionByWorktrees } from '../../../shared/workspace-session-window-rebase'
import { buildWorkspaceSessionPayload } from './workspace-session'

/**
 * Lets go of workspaces another window now serves, without a reload and without touching a
 * single process.
 *
 * Removal only: the window that took the project over reads its own half from main and reconnects
 * its terminals there. PTYs live in main and survive a renderer dropping them — this is the same
 * scoped hydration a remote snapshot performs (`hooks/remote-workspace-snapshot-apply.ts`), with
 * the released keys simply absent from the session being hydrated.
 */
export function releaseWorkspacesToAnotherWindow(
  state: AppState,
  workspaceKeys: readonly string[]
): void {
  const present = workspaceKeys.filter((key) => state.tabsByWorktree[key] !== undefined)
  if (present.length === 0) {
    return
  }
  // `rest` is this window's session minus the released keys — including the active focus, which
  // is cleared exactly when it named one of them.
  const remaining = partitionWorkspaceSessionByWorktrees(
    buildWorkspaceSessionPayload(state),
    new Set(present)
  ).rest
  state.hydrateWorkspaceSession(remaining, { replaceWorkspaceKeys: present })
  state.hydrateTabsSession(remaining, { replaceWorkspaceKeys: present })
}
