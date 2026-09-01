import { BrowserWindow, Menu, app } from 'electron'
import {
  formatKeybindingList,
  getEffectiveKeybindingsForAction,
  type KeybindingActionId,
  type KeybindingOverrides
} from '../../shared/keybindings'
import type { UpdateCheckOptions } from '../../shared/update-status-types'
import { translateMain } from '../i18n/main-i18n'
import { createAppMenuSelectionItem } from './app-menu-selection-item'
import { reloadMenuTarget } from './menu-target-web-contents'
import {
  buildAppearanceSubmenu,
  getNextDefaultOnAppearanceSettingValue,
  type AppearanceMenuKey,
  type AppearanceMenuState
} from './register-app-menu-appearance'

export type { AppearanceMenuKey, AppearanceMenuState }
export { getNextDefaultOnAppearanceSettingValue }

type RegisterAppMenuOptions = {
  /** Read once at startup; gates the experimental File > New Window entry. */
  multiWindowEnabled: boolean
  onNewWindow: () => void
  onOpenSettings: (window?: Electron.BaseWindow | null) => void
  onOpenSetupGuide: (window?: Electron.BaseWindow | null) => void
  onOpenFeatureTour: (window?: Electron.BaseWindow | null) => void
  onOpenCrashReport: (window?: Electron.BaseWindow | null) => void
  onRecoverTerminal: (window?: Electron.BaseWindow | null) => void
  onCheckForUpdates: (options: UpdateCheckOptions) => void
  onBeforeReload?: (options: { ignoreCache: boolean; webContentsId: number }) => void
  onZoomIn: (window?: Electron.BaseWindow | null) => void
  onZoomOut: (window?: Electron.BaseWindow | null) => void
  onZoomReset: (window?: Electron.BaseWindow | null) => void
  onToggleLeftSidebar: (window?: Electron.BaseWindow | null) => void
  onToggleRightSidebar: (window?: Electron.BaseWindow | null) => void
  onToggleAppearance: (key: AppearanceMenuKey, window?: Electron.BaseWindow | null) => void
  getAppearanceState: () => AppearanceMenuState
  getKeybindings?: () => KeybindingOverrides | undefined
  // Why: the macOS app-menu title. Passed the per-branch dev label since
  // app.name is now pinned to a stable value for Keychain-key stability.
  appMenuLabel?: string
}

function buildAndApplyMenu(options: RegisterAppMenuOptions): void {
  const {
    multiWindowEnabled,
    onNewWindow,
    onOpenSettings,
    onOpenSetupGuide,
    onRecoverTerminal,
    onOpenFeatureTour,
    onOpenCrashReport,
    onCheckForUpdates,
    onBeforeReload,
    onZoomIn,
    onZoomOut,
    onZoomReset,
    onToggleLeftSidebar,
    onToggleRightSidebar,
    onToggleAppearance,
    getAppearanceState,
    getKeybindings
  } = options

  const isMac = process.platform === 'darwin'
  const appearance = getAppearanceState()
  const shortcutLabel = (actionId: KeybindingActionId): string => {
    const bindings = getEffectiveKeybindingsForAction(
      actionId,
      process.platform,
      getKeybindings?.()
    )
    return formatKeybindingList(bindings, process.platform)
  }

  // Why: modifier-click update checks are hidden power-user affordances.
  // Extracted so the macOS app-menu entry and Windows/Linux Help entry share
  // identical RC/perf channel routing.
  const checkForUpdatesClick: Electron.MenuItemConstructorOptions['click'] = (
    _menuItem,
    _window,
    event
  ) => {
    const modifierClick = !event.triggeredByAccelerator
    const localBuild = isMac && modifierClick && event.altKey === true
    const includePerfPrerelease =
      !localBuild && modifierClick && (isMac ? event.metaKey === true : event.ctrlKey === true)
    const includePrerelease = !localBuild && modifierClick && event.shiftKey === true
    onCheckForUpdates({
      includePrerelease,
      includePerfPrerelease,
      ...(localBuild ? { localBuild: true } : {})
    })
  }

  const checkForUpdatesItem: Electron.MenuItemConstructorOptions = {
    label: translateMain('menu.checkForUpdates', 'Check for Updates...'),
    click: checkForUpdatesClick
  }

  const settingsItem: Electron.MenuItemConstructorOptions = {
    label: `${translateMain('menu.settings', 'Settings')}\t${shortcutLabel('app.settings')}`,
    click: (_menuItem, window) => onOpenSettings(window)
  }

  const newWindowItem: Electron.MenuItemConstructorOptions = {
    label: `${translateMain('menu.newWindow', 'New Window')}\t${shortcutLabel('app.newWindow')}`,
    click: () => onNewWindow()
  }

  const featureTourItem: Electron.MenuItemConstructorOptions = {
    label: translateMain('menu.exploreOrca', 'Explore Orca'),
    click: (_menuItem, window) => onOpenFeatureTour(window)
  }

  const setupGuideItem: Electron.MenuItemConstructorOptions = {
    label: translateMain('menu.gettingStarted', 'Getting Started with Orca'),
    click: (_menuItem, window) => onOpenSetupGuide(window)
  }

  const crashReportItem: Electron.MenuItemConstructorOptions = {
    label: translateMain('menu.reportCrash', 'Report Crash...'),
    click: (_menuItem, window) => onOpenCrashReport(window)
  }

  // Why: the macOS app-menu (named after the app) is mandatory on darwin and
  // owns hide/hideOthers/unhide/services/quit roles that only make sense in
  // the system menu bar. On Windows/Linux that menu would render as a
  // redundant "Orca" entry with roles that don't apply, so we omit it there
  // and distribute its items across File / Help instead.
  const macAppMenu: Electron.MenuItemConstructorOptions = {
    label: options.appMenuLabel ?? app.name,
    submenu: [
      { role: 'about' },
      checkForUpdatesItem,
      settingsItem,
      { type: 'separator' },
      { role: 'services' },
      { type: 'separator' },
      { role: 'hide' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      { type: 'separator' },
      { role: 'quit' }
    ]
  }

  const fileMenu: Electron.MenuItemConstructorOptions = {
    label: translateMain('menu.file', 'File'),
    submenu: [
      // Why: the multi-window path is experimental and read at startup, so the
      // entry stays hidden until the user opts in and restarts.
      ...(multiWindowEnabled
        ? ([newWindowItem] satisfies Electron.MenuItemConstructorOptions[])
        : []),
      // Why: on Windows/Linux there is no app-named menu, so Settings and
      // Quit live under File — matching the common platform convention and
      // keeping all user-facing actions reachable from the in-window menu bar.
      ...(isMac
        ? []
        : ([
            { type: 'separator' },
            settingsItem,
            { type: 'separator' },
            { role: 'quit', label: translateMain('menu.exit', 'Exit') }
          ] satisfies Electron.MenuItemConstructorOptions[]))
    ]
  }
  const shouldIncludeFileMenu =
    Array.isArray(fileMenu.submenu) && fileMenu.submenu.some((item) => item.type !== 'separator')

  // Why: keep native menu hints while letting non-macOS Ctrl+Z/Ctrl+Y reach the focused terminal or DOM control.
  const undoRedoOptions: Electron.MenuItemConstructorOptions = isMac
    ? {}
    : { registerAccelerator: false }
  const editMenu: Electron.MenuItemConstructorOptions = {
    label: translateMain('menu.edit', 'Edit'),
    submenu: [
      { role: 'undo', ...undoRedoOptions },
      { role: 'redo', ...undoRedoOptions },
      { type: 'separator' },
      { role: 'cut' },
      createAppMenuSelectionItem({
        action: 'copy',
        label: translateMain('menu.copy', 'Copy'),
        isMac
      }),
      {
        label: translateMain('menu.paste', 'Paste'),
        accelerator: 'CmdOrCtrl+V',
        click: () => {
          // Why: a focused terminal/native-chat pane is not a native editable
          // control, so raw Electron paste cannot know which Orca surface owns it.
          const focusedWindow = BrowserWindow.getFocusedWindow()
          if (focusedWindow) {
            focusedWindow.webContents.send('ui:appMenuPaste')
            return
          }

          // Why: a macOS native panel (open/save, Go to Folder) leaves no focused
          // BrowserWindow, so overriding the paste role would strand Cmd+V as a no-op.
          if (isMac) {
            Menu.sendActionToFirstResponder('paste:')
          }
        }
      },
      createAppMenuSelectionItem({
        action: 'select-all',
        label: translateMain('menu.selectAll', 'Select All'),
        isMac
      })
    ]
  }

  // Why: mirror VS Code's View > Appearance submenu so users can toggle
  // sidebar/status-bar/tasks-button/titlebar-activity from the menu bar as
  // well as from the settings pane. Electron doesn't reactively update
  // menu items when the backing state changes, so rebuildAppMenu() must be
  // called after every settings update — each build reads current
  // appearance state through getAppearanceState() and produces a fresh
  // template with accurate `checked` values.
  const appearanceSubmenu = buildAppearanceSubmenu({
    appearance,
    shortcutLabel,
    onToggleLeftSidebar,
    onToggleRightSidebar,
    onToggleAppearance
  })

  const viewMenu: Electron.MenuItemConstructorOptions = {
    label: translateMain('menu.view', 'View'),
    submenu: [
      {
        label: translateMain('menu.reload', 'Reload'),
        click: (_menuItem, window) => reloadMenuTarget(window, false, onBeforeReload)
      },
      {
        label: `${translateMain('menu.forceReload', 'Force Reload')}\t${shortcutLabel('app.forceReload')}`,
        click: (_menuItem, window) => reloadMenuTarget(window, true, onBeforeReload)
      },
      { role: 'toggleDevTools' },
      { type: 'separator' },
      {
        label: `${translateMain('menu.resetSize', 'Reset Size')}\t${shortcutLabel('zoom.reset')}`,
        click: (_menuItem, window) => onZoomReset(window)
      },
      {
        label: `${translateMain('menu.zoomIn', 'Zoom In')}\t${shortcutLabel('zoom.in')}`,
        click: (_menuItem, window) => onZoomIn(window)
      },
      {
        label: `${translateMain('menu.zoomOut', 'Zoom Out')}\t${shortcutLabel('zoom.out')}`,
        click: (_menuItem, window) => onZoomOut(window)
      },
      { type: 'separator' },
      {
        // Why: display-only shortcut hint — do NOT set `accelerator` here.
        // Menu accelerators intercept key events at the main-process level
        // before the renderer's keydown handler fires. The overlay
        // mutual-exclusion logic (which runs in the renderer) would be
        // bypassed if this were a real accelerator binding.
        label: `${translateMain('menu.openWorktreePalette', 'Open Worktree Palette')}\t${shortcutLabel('worktree.palette')}`
      },
      { type: 'separator' },
      { role: 'togglefullscreen' },
      { type: 'separator' },
      appearanceSubmenu
    ]
  }

  const windowMenu: Electron.MenuItemConstructorOptions = {
    label: translateMain('menu.window', 'Window'),
    submenu: [
      { role: 'minimize' },
      { role: 'zoom' },
      { type: 'separator' },
      {
        // Why no accelerator: menu accelerators fire in main before the renderer's
        // keydown handler, and this action must reach the focused terminal pane.
        label: translateMain('menu.recoverTerminal', 'Recover Terminal'),
        click: (_menuItem, window) => onRecoverTerminal(window)
      }
    ]
  }

  const helpMenu: Electron.MenuItemConstructorOptions = {
    label: translateMain('menu.help', 'Help'),
    submenu: [
      crashReportItem,
      { type: 'separator' },
      featureTourItem,
      setupGuideItem,
      ...(isMac
        ? []
        : ([
            { type: 'separator' },
            { role: 'about' },
            checkForUpdatesItem
          ] satisfies Electron.MenuItemConstructorOptions[]))
    ]
  }

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [macAppMenu] : []),
    ...(shouldIncludeFileMenu ? [fileMenu] : []),
    editMenu,
    viewMenu,
    windowMenu,
    helpMenu
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

let lastRegisterOptions: RegisterAppMenuOptions | null = null

export function registerAppMenu(options: RegisterAppMenuOptions): void {
  lastRegisterOptions = options
  buildAndApplyMenu(options)
}

/** Rebuild the application menu using the options from the most recent
 *  registerAppMenu call. Used to refresh checkbox `checked` state when
 *  settings that feed the Appearance submenu change, since Electron's
 *  menu items do not reactively re-render when the backing state updates. */
export function rebuildAppMenu(): void {
  if (lastRegisterOptions) {
    buildAndApplyMenu(lastRegisterOptions)
  }
}
