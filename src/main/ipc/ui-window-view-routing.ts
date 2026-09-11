import type { WebContents } from 'electron'
import type { PersistedUIState } from '../../shared/persisted-ui-state-types'
import { pickWindowViewState, splitWindowViewUpdates } from '../../shared/window-view-state'
import type { Store } from '../persistence'
import {
  getFocusedOrLastActiveMainWindow,
  getMainWindowForWebContents
} from '../window/main-window-registry'
import {
  ensureWindowViewState,
  getWindowViewState,
  resolveWindowIdForWebContents,
  updateWindowViewState
} from '../window/window-view-state-registry'

type UIStore = Pick<Store, 'getUI' | 'updateUI'>

/**
 * Routes the UI channels by sending window: per-window keys (see shared/window-view-state) go to
 * that window's in-memory view-state, everything else stays the profile-wide blob.
 *
 * The persisted copy of the per-window keys is the seed for every new window and the next
 * launch, so a single-window user keeps their filter across restarts exactly as before.
 */
export function readUIForRenderer(
  store: UIStore,
  sender: Pick<WebContents, 'id'>
): PersistedUIState {
  const ui = store.getUI()
  const windowId = resolveWindowIdForWebContents(sender.id)
  if (!windowId) {
    return ui
  }
  return { ...ui, ...ensureWindowViewState(windowId, () => pickWindowViewState(ui)) }
}

/** Overlays a window's own view-state on a profile broadcast so a sync never carries another window's filter. */
export function overlayWindowViewState(
  ui: PersistedUIState,
  webContentsId: number
): PersistedUIState {
  const windowId = resolveWindowIdForWebContents(webContentsId)
  const view = windowId ? getWindowViewState(windowId) : null
  return view ? { ...ui, ...view } : ui
}

function isViewStatePersistingWindow(sender: WebContents): boolean {
  const window = getMainWindowForWebContents(sender)
  return window !== null && getFocusedOrLastActiveMainWindow()?.id === window.id
}

export function applyRendererUIUpdate(
  store: UIStore,
  sender: WebContents,
  updates: Partial<PersistedUIState>
): void {
  const windowId = resolveWindowIdForWebContents(sender.id)
  if (!windowId) {
    // Why: renderers outside a main window (dashboard pop-out) keep the pre-feature global write.
    store.updateUI(updates)
    return
  }
  const { windowView, global } = splitWindowViewUpdates(updates)
  if (!windowView) {
    store.updateUI(global)
    return
  }
  updateWindowViewState(windowId, windowView, () => pickWindowViewState(store.getUI()))
  // Why: only the window the user is looking at may rewrite the persisted seed; a background
  // window's catalog pruning or hydration echo must not overwrite the focused window's choice.
  const persisted = isViewStatePersistingWindow(sender) ? { ...global, ...windowView } : global
  if (Object.keys(persisted).length > 0) {
    store.updateUI(persisted)
  }
}
