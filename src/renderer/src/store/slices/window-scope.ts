import type { StateCreator } from 'zustand'
import type { AppState } from '../types'
import {
  isSameWindowScope,
  type ProjectGroupWindowOpenResult,
  type WindowScope,
  type WindowScopeChangedPayload,
  type WindowScopeChangeResult,
  type WindowScopeSnapshot
} from '../../../../shared/window-scope'

/**
 * The project group this window is bound to (docs/reference/per-window-view-state.md). Main is
 * the authority: the snapshot arrives with startup hydration and every rebind lands through
 * `ui:windowScopeChanged`; nothing here reads the frozen argv id.
 */
export type WindowScopeSlice = {
  windowScope: WindowScope | null
  /** False until main answered; before that the sidebar treats the window as free. */
  windowScopeReady: boolean
  /** Launch-time multi-window flag; false hides "Open in new window" and the scoped-filter row. */
  scopedWindowsEnabled: boolean
  applyWindowScopeSnapshot: (snapshot: WindowScopeSnapshot) => void
  applyWindowScopeChange: (payload: WindowScopeChangedPayload) => void
  openProjectGroupWindow: (projectGroupId: string) => Promise<ProjectGroupWindowOpenResult>
  bindWindowToProjectGroup: (projectGroupId: string) => Promise<WindowScopeChangeResult>
  releaseWindowScope: () => Promise<WindowScopeChangeResult>
}

function projectGroupLabel(state: AppState, projectGroupId: string): string | null {
  return state.projectGroups.find((group) => group.id === projectGroupId)?.name ?? null
}

export const createWindowScopeSlice: StateCreator<AppState, [], [], WindowScopeSlice> = (
  set,
  get
) => ({
  windowScope: null,
  windowScopeReady: false,
  scopedWindowsEnabled: false,

  applyWindowScopeSnapshot: (snapshot) =>
    set((s) => ({
      windowScope: isSameWindowScope(s.windowScope, snapshot.scope)
        ? s.windowScope
        : snapshot.scope,
      scopedWindowsEnabled: snapshot.scopedWindowsEnabled,
      windowScopeReady: true
    })),

  // Why: a rebind replaces the project filter wholesale — the derived one when bound, the
  // persisted multi-pick when released — so the filter and the scope never disagree.
  applyWindowScopeChange: (payload) =>
    set((s) => ({
      windowScope: isSameWindowScope(s.windowScope, payload.scope) ? s.windowScope : payload.scope,
      scopedWindowsEnabled: payload.scopedWindowsEnabled,
      windowScopeReady: true,
      filterRepoIds: payload.viewState.filterRepoIds,
      filterGroupIds: payload.viewState.filterGroupIds
    })),

  openProjectGroupWindow: async (projectGroupId) => {
    try {
      return await window.api.ui.openProjectGroupWindow({
        projectGroupId,
        projectLabel: projectGroupLabel(get(), projectGroupId)
      })
    } catch (error) {
      console.error('Failed to open project window:', error)
      return { status: 'unavailable' }
    }
  },

  bindWindowToProjectGroup: async (projectGroupId) => {
    try {
      return await window.api.ui.setWindowScope({
        projectGroupId,
        projectLabel: projectGroupLabel(get(), projectGroupId)
      })
    } catch (error) {
      console.error('Failed to bind window to project:', error)
      return { status: 'unavailable' }
    }
  },

  releaseWindowScope: async () => {
    try {
      return await window.api.ui.setWindowScope(null)
    } catch (error) {
      console.error('Failed to release window scope:', error)
      return { status: 'unavailable' }
    }
  }
})
