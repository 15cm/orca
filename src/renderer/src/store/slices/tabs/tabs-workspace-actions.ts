import type { AppState } from '../../types'
import type { TabsSlice, TabsSliceGet, TabsSliceSet } from './tabs-slice-contract'
import { buildTabWorkspaceMove, type TabWorkspaceMove } from '../tab-workspace-move'
import { buildActiveSurfacePatch, buildBackgroundSurfacePatch } from '../tab-active-surface'

export function createTabsWorkspaceActions(
  set: TabsSliceSet,
  get: TabsSliceGet
): Pick<TabsSlice, 'moveUnifiedTabToWorkspace'> {
  return {
    moveUnifiedTabToWorkspace: (tabId, targetWorktreeId): TabWorkspaceMove | null => {
      let move: TabWorkspaceMove | null = null
      set((state: AppState) => {
        const built = buildTabWorkspaceMove(state, tabId, targetWorktreeId)
        if (!built) {
          return {}
        }
        move = built
        const next = { ...state, ...built.patch }
        const surfaces = [built.sourceWorktreeId, built.targetWorktreeId]
        const background = surfaces.filter((id) => id !== state.activeWorktreeId)
        let patched: Partial<AppState> = {
          ...built.patch,
          ...buildBackgroundSurfacePatch(next, background)
        }
        if (surfaces.includes(state.activeWorktreeId ?? '')) {
          const active = state.activeWorktreeId as string
          patched = {
            ...patched,
            ...buildActiveSurfacePatch(
              { ...next, ...patched },
              active,
              (patched.activeGroupIdByWorktree ?? next.activeGroupIdByWorktree)[active] ?? null
            )
          }
        }
        return patched
      })
      if (move) {
        get().recordFeatureInteraction?.('terminal-tabs')
      }
      return move
    }
  }
}
