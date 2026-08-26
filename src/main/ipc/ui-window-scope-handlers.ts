import { ipcMain, type BrowserWindow, type WebContents } from 'electron'
import { z } from 'zod'
import type { WindowScopeChangeResult } from '../../shared/window-scope'
import { pickWindowViewState } from '../../shared/window-view-state'
import type { Store } from '../persistence'
import { getMainWindowForWebContents } from '../window/main-window-registry'
import {
  bindWindowToProjectGroup,
  getWindowScopeSnapshotForWebContents,
  openProjectGroupWindow,
  releaseWindowScope,
  setWindowScopeLabel
} from '../window/window-scope-binding'

type UIStore = Pick<Store, 'getUI'>

export type UIWindowScopeHandlerOptions = {
  /** Opens a main window under the given id; null when the app cannot open one right now. */
  openScopedMainWindow?: (windowId: string) => BrowserWindow | null
}

const MAX_PROJECT_LABEL_LENGTH = 200

const ProjectGroupWindowArgs = z.object({
  projectGroupId: z.string().min(1),
  projectLabel: z.string().max(MAX_PROJECT_LABEL_LENGTH).nullable().optional()
})

function parseProjectGroupWindowArgs(
  raw: unknown
): { projectGroupId: string; projectLabel: string | null } | null {
  const parsed = ProjectGroupWindowArgs.safeParse(raw)
  return parsed.success
    ? {
        projectGroupId: parsed.data.projectGroupId,
        projectLabel: parsed.data.projectLabel ?? null
      }
    : null
}

/** The scope channels of the `ui` API; see window/window-scope-binding for the model. */
export function registerUIWindowScopeHandlers(
  store: UIStore,
  options: UIWindowScopeHandlerOptions = {}
): void {
  const seed = () => pickWindowViewState(store.getUI())
  const mainWindowOf = (sender: WebContents): BrowserWindow | null =>
    getMainWindowForWebContents(sender)

  ipcMain.handle('ui:getWindowScope', (event) =>
    getWindowScopeSnapshotForWebContents(event.sender.id)
  )

  ipcMain.handle('ui:openProjectGroupWindow', (event, rawArgs: unknown) => {
    const args = parseProjectGroupWindowArgs(rawArgs)
    const openWindow = options.openScopedMainWindow
    if (!args || !openWindow || !mainWindowOf(event.sender)) {
      return { status: 'unavailable' as const }
    }
    return openProjectGroupWindow({ ...args, openWindow })
  })

  ipcMain.handle('ui:setWindowScope', (event, rawArgs: unknown): WindowScopeChangeResult => {
    const window = mainWindowOf(event.sender)
    if (!window) {
      return { status: 'unavailable' }
    }
    if (rawArgs === null) {
      return releaseWindowScope(window, seed)
    }
    const args = parseProjectGroupWindowArgs(rawArgs)
    return args ? bindWindowToProjectGroup(window, args, seed) : { status: 'unavailable' }
  })

  ipcMain.removeAllListeners('ui:setWindowScopeLabel')
  ipcMain.on('ui:setWindowScopeLabel', (event, label: unknown) => {
    const window = mainWindowOf(event.sender)
    if (!window) {
      return
    }
    const trimmed = typeof label === 'string' ? label.trim().slice(0, MAX_PROJECT_LABEL_LENGTH) : ''
    setWindowScopeLabel(window, trimmed.length > 0 ? trimmed : null)
  })
}
