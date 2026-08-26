import type { BrowserWindow } from 'electron'

/**
 * The one composition rule for a main window's title: `<project> — <app name>` while the window
 * is bound to a project group, the bare app name otherwise (Orca, or the per-branch dev name).
 *
 * Honest scope: macOS shows this in Mission Control and the window switcher — the one-window-
 * per-display case. Windows hides the native title bar (`titleBarStyle: 'hidden'`) and Linux
 * drops the frame, so there it only surfaces on taskbar hover; the sidebar header label is the
 * affordance that works on all three.
 */
export function composeMainWindowTitle(appName: string, projectLabel: string | null): string {
  const label = projectLabel?.trim() ?? ''
  return label.length > 0 ? `${label} — ${appName}` : appName
}

type MainWindowTitleState = { appName: string; projectLabel: string | null }

const titleStateByWindow = new WeakMap<BrowserWindow, MainWindowTitleState>()

export function installMainWindowTitle(window: BrowserWindow, appName: string): void {
  titleStateByWindow.set(window, { appName, projectLabel: null })
  // Why: the renderer's <title> would otherwise replace a project title on every (re)load.
  window.on('page-title-updated', (event) => {
    if (titleStateByWindow.get(window)?.projectLabel) {
      event.preventDefault()
    }
  })
}

export function setMainWindowProjectLabel(
  window: BrowserWindow,
  projectLabel: string | null
): void {
  const state = titleStateByWindow.get(window) ?? {
    appName: 'Orca',
    projectLabel: null
  }
  state.projectLabel = projectLabel
  titleStateByWindow.set(window, state)
  if (!window.isDestroyed()) {
    window.setTitle(composeMainWindowTitle(state.appName, projectLabel))
  }
}
