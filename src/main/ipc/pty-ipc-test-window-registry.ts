import {
  _resetMainWindowRegistryForTests,
  registerMainWindow
} from '../window/main-window-registry'
import { setMainWindowElectronBindings } from '../window/main-window-electron-bindings'

type TestWindow = { webContents: unknown }

/**
 * Makes suite-local fake windows resolvable the way Orca's real ones are.
 *
 * PTY input admission looks the sender up in the main-window registry, so a suite
 * whose window is unknown to it would have every keystroke rejected. Foreign
 * senders still resolve to null, which is what the cross-window cases assert.
 */
export function createPtyIpcTestWindowRegistry(): {
  install: (mainWindow: TestWindow) => void
  trackTestMainWindow: (window: TestWindow, options?: { exclusive?: boolean }) => void
} {
  const testWindows = new Set<TestWindow>()

  const install = (mainWindow: TestWindow): void => {
    _resetMainWindowRegistryForTests()
    testWindows.clear()
    testWindows.add(mainWindow)
    setMainWindowElectronBindings({
      // Why null: suites assert delivery pacing that reads focus elsewhere; admission
      // only needs sender resolution, so leave focus as these suites had it.
      getFocusedWindow: () => null,
      fromWebContents: (webContents) =>
        ([...testWindows].find((window) => window.webContents === webContents) ?? null) as never,
      isBrowserWindow: (window): window is never => testWindows.has(window as never)
    })
    registerMainWindow(mainWindow as never)
  }

  const trackTestMainWindow = (window: TestWindow, options: { exclusive?: boolean } = {}): void => {
    if (options.exclusive) {
      _resetMainWindowRegistryForTests()
      testWindows.clear()
    }
    testWindows.add(window)
    registerMainWindow(window as never)
  }

  return { install, trackTestMainWindow }
}
