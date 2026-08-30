import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () =>
  (await import('./createMainWindow-test-harness')).electronModuleMock()
)
vi.mock('@electron-toolkit/utils', async () =>
  (await import('./createMainWindow-test-harness')).electronToolkitUtilsMock()
)
vi.mock('./macos-tahoe-release', async () =>
  (await import('./createMainWindow-test-harness')).macosTahoeReleaseMock()
)
vi.mock('../app-icon', async () => (await import('./createMainWindow-test-harness')).appIconMock())
vi.mock('../browser/browser-manager', async () =>
  (await import('./createMainWindow-test-harness')).browserManagerMock()
)
vi.mock('./main-window-registry', async () =>
  (await import('./createMainWindow-test-harness')).mainWindowRegistryMock()
)

import { createMainWindow } from './createMainWindow'
import { projectGroupWindowScopeKey } from '../../shared/window-scope'
import {
  _resetWindowViewStateRegistryForTests,
  setScopedWindowsEnabled
} from './window-view-state-registry'
import {
  browserWindowMock,
  hasLiveMainWindowsMock,
  resetMainWindowMocks
} from './createMainWindow-test-harness'

function stubBrowserWindow(): void {
  const webContents = {
    id: 7,
    on: vi.fn(),
    setZoomLevel: vi.fn(),
    setBackgroundThrottling: vi.fn(),
    invalidate: vi.fn(),
    setWindowOpenHandler: vi.fn(),
    send: vi.fn(),
    isDestroyed: vi.fn(() => false),
    isDevToolsOpened: vi.fn(),
    openDevTools: vi.fn(),
    closeDevTools: vi.fn()
  }
  browserWindowMock.mockImplementation(function () {
    return {
      webContents,
      on: vi.fn(),
      isDestroyed: vi.fn(() => false),
      isMaximized: vi.fn(() => false),
      isFullScreen: vi.fn(() => false),
      getSize: vi.fn(() => [1200, 800]),
      setSize: vi.fn(),
      maximize: vi.fn(),
      show: vi.fn(),
      loadFile: vi.fn(() => Promise.resolve()),
      loadURL: vi.fn(() => Promise.resolve())
    }
  })
}

function rendererArgv(): string[] {
  return browserWindowMock.mock.calls[0]?.[0]?.webPreferences?.additionalArguments ?? []
}

describe('createMainWindow session adoption', () => {
  beforeEach(() => {
    resetMainWindowMocks()
    _resetWindowViewStateRegistryForTests()
    stubBrowserWindow()
  })

  afterEach(() => {
    _resetWindowViewStateRegistryForTests()
  })

  it('marks a project window scoped while another window is up', () => {
    setScopedWindowsEnabled(true)
    hasLiveMainWindowsMock.mockReturnValue(true)

    createMainWindow(null, { windowId: projectGroupWindowScopeKey('perc') })

    expect(rendererArgv()).toContain('--orca-window-session=scoped')
  })

  it('hydrates the shared session in the launch’s first window, scope or not', () => {
    // Why: relaunching into a window with no workspaces or tabs is the regression this guards.
    setScopedWindowsEnabled(true)
    hasLiveMainWindowsMock.mockReturnValue(false)

    createMainWindow(null, { windowId: projectGroupWindowScopeKey('perc') })

    expect(rendererArgv()).toContain('--orca-window-session=shared')
  })

  it('leaves a new free window on the shared session', () => {
    setScopedWindowsEnabled(true)
    hasLiveMainWindowsMock.mockReturnValue(true)

    createMainWindow(null)

    expect(rendererArgv()).toContain('--orca-window-session=shared')
  })

  it('changes nothing while the multi-window flag is off', () => {
    setScopedWindowsEnabled(false)
    hasLiveMainWindowsMock.mockReturnValue(true)

    createMainWindow(null, { windowId: projectGroupWindowScopeKey('perc') })

    expect(rendererArgv()).toContain('--orca-window-session=shared')
  })
})
