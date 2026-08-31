import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({}))

import type { Store } from '../persistence'
import { setMainWindowElectronBindings } from './main-window-electron-bindings'
import { _resetMainWindowRegistryForTests, registerMainWindow } from './main-window-registry'
import { publishWorkspaceSessionRelease } from './project-window-session-release'
import { WORKSPACE_SESSION_RELEASE_CHANNEL } from '../../shared/workspace-session-release'
import { getDefaultWorkspaceSession } from '../../shared/constants'
import {
  _resetWindowViewStateRegistryForTests,
  bindWindowIdToWebContents,
  setScopedWindowsEnabled
} from './window-view-state-registry'

const PROJECT_WT = 'repo-orca::/wt/orca'
const PROJECT_FOLDER = 'folder:terminals'
const OTHER_WT = 'repo-cce::/wt/cce'

function createWindow(
  id: number,
  windowId: string
): { webContents: { send: ReturnType<typeof vi.fn> } } {
  const window = {
    id,
    webContents: { id: id * 10, isDestroyed: () => false, send: vi.fn() },
    isDestroyed: () => false,
    on: () => {},
    once: () => {},
    removeListener: () => {}
  }
  registerMainWindow(window as never)
  bindWindowIdToWebContents(window.webContents.id, windowId)
  return window
}

function createStore(): Store {
  return {
    getWorkspaceSession: () => ({
      ...getDefaultWorkspaceSession(),
      tabsByWorktree: {
        [PROJECT_WT]: [],
        [PROJECT_FOLDER]: [],
        [OTHER_WT]: []
      }
    }),
    getRepo: (repoId: string) =>
      repoId === 'repo-orca'
        ? { projectGroupId: 'orca' }
        : repoId === 'repo-cce'
          ? { projectGroupId: 'cce' }
          : undefined,
    getFolderWorkspaces: () => [{ id: 'terminals', projectGroupId: 'orca' }],
    getProjectGroups: () => [
      { id: 'orca', parentGroupId: null },
      { id: 'cce', parentGroupId: null }
    ]
  } as unknown as Store
}

function sentKeys(window: { webContents: { send: ReturnType<typeof vi.fn> } }): string[] | null {
  const call = window.webContents.send.mock.calls.find(
    ([channel]) => channel === WORKSPACE_SESSION_RELEASE_CHANNEL
  )
  return call ? [...(call[1] as { workspaceKeys: string[] }).workspaceKeys].sort() : null
}

describe('publishWorkspaceSessionRelease', () => {
  beforeEach(() => {
    _resetMainWindowRegistryForTests()
    _resetWindowViewStateRegistryForTests()
    setScopedWindowsEnabled(true)
    setMainWindowElectronBindings({
      getFocusedWindow: () => null,
      fromWebContents: () => null,
      isBrowserWindow: (window): window is never => window !== null
    })
  })

  it('tells the free window to let go of the project, folder workspaces included', () => {
    const free = createWindow(1, 'free-window-uuid')
    createWindow(2, 'group:orca')

    publishWorkspaceSessionRelease(createStore())

    expect(sentKeys(free)).toEqual([PROJECT_FOLDER, PROJECT_WT])
  })

  it('tells a project window to let go of everything outside its project', () => {
    createWindow(1, 'free-window-uuid')
    const project = createWindow(2, 'group:orca')

    publishWorkspaceSessionRelease(createStore())

    expect(sentKeys(project)).toEqual([OTHER_WT])
  })

  it('says nothing while a single window is up', () => {
    const free = createWindow(1, 'free-window-uuid')

    publishWorkspaceSessionRelease(createStore())

    expect(sentKeys(free)).toBeNull()
  })
})
