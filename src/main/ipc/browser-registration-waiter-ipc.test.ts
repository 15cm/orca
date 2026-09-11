import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  handleMock,
  registerGuestMock,
  getGuestWebContentsIdMock,
  getRendererWebContentsIdMock,
  getWebContentsIdByTabIdMock,
  getWorktreeIdForTabMock,
  webContentsFromIdMock
} = vi.hoisted(() => ({
  handleMock: vi.fn(),
  registerGuestMock: vi.fn(() => true),
  getGuestWebContentsIdMock: vi.fn(() => null),
  getRendererWebContentsIdMock: vi.fn(() => null),
  getWebContentsIdByTabIdMock: vi.fn(() => new Map()),
  getWorktreeIdForTabMock: vi.fn(),
  webContentsFromIdMock: vi.fn<() => { isDestroyed: () => boolean }>(() => ({
    isDestroyed: () => false
  }))
}))

vi.mock('electron', () => ({
  ipcMain: { removeHandler: vi.fn(), handle: handleMock },
  webContents: { fromId: webContentsFromIdMock },
  BrowserWindow: { fromWebContents: vi.fn() }
}))
vi.mock('../browser/browser-manager', () => ({
  browserCertificateTrustController: { proceed: vi.fn(() => ({ ok: true })) },
  browserManager: {
    registerGuest: registerGuestMock,
    attachGuestPolicies: vi.fn(),
    unregisterGuest: vi.fn(),
    getGuestWebContentsId: getGuestWebContentsIdMock,
    getRendererWebContentsId: getRendererWebContentsIdMock,
    getWebContentsIdByTabId: getWebContentsIdByTabIdMock,
    getWorktreeIdForTab: getWorktreeIdForTabMock,
    getAuthorizedGuest: vi.fn(),
    setGrabMode: vi.fn(),
    openDevTools: vi.fn(),
    setAnnotationViewportBridge: vi.fn(),
    cancelDownload: vi.fn()
  }
}))

import { registerBrowserHandlers } from './browser'
import {
  waitForAnyTabRegistration,
  waitForWorktreeTabRegistration
} from './browser-tab-registration-wait'

type RegistrationHandler = (
  event: { sender: Electron.WebContents },
  args: {
    browserPageId: string
    workspaceId: string
    worktreeId: string
    webContentsId: number
  }
) => boolean

describe('browser registration waiter IPC', () => {
  beforeEach(() => {
    vi.stubEnv('ELECTRON_RENDERER_URL', '')
    handleMock.mockReset()
    registerGuestMock.mockReset().mockReturnValue(true)
    getGuestWebContentsIdMock.mockReset().mockReturnValue(null)
    getRendererWebContentsIdMock.mockReset().mockReturnValue(null)
    getWebContentsIdByTabIdMock.mockReset().mockReturnValue(new Map())
    getWorktreeIdForTabMock.mockReset()
    webContentsFromIdMock.mockReset().mockReturnValue({ isDestroyed: () => false })
  })

  it('resolves worktree and any-tab waiters when a guest registers', async () => {
    vi.useFakeTimers()
    try {
      const worktreeWait = waitForWorktreeTabRegistration('worktree-1', 1000)
      const anyWait = waitForAnyTabRegistration(1000)
      registerBrowserHandlers()
      const registerHandler = handleMock.mock.calls.find(
        ([channel]) => channel === 'browser:registerGuest'
      )?.[1] as RegistrationHandler
      expect(
        registerHandler(
          {
            sender: {
              id: 91,
              isDestroyed: () => false,
              getType: () => 'window',
              getURL: () => 'file:///renderer/index.html'
            } as Electron.WebContents
          },
          {
            browserPageId: 'page-worktree-1',
            workspaceId: 'workspace-1',
            worktreeId: 'worktree-1',
            webContentsId: 123
          }
        )
      ).toBe(true)
      await vi.advanceTimersByTimeAsync(1001)
      await expect(worktreeWait).resolves.toBeUndefined()
      await expect(anyWait).resolves.toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('resolves worktree waits immediately for an existing tab', async () => {
    getWebContentsIdByTabIdMock.mockReturnValue(new Map([['page-1', 123]]))
    getWorktreeIdForTabMock.mockReturnValue('worktree-1')
    await expect(waitForWorktreeTabRegistration('worktree-1', 1000)).resolves.toBeUndefined()
    expect(getWorktreeIdForTabMock).toHaveBeenCalledWith('page-1')
  })

  it('resolves any-tab waits immediately for an existing tab', async () => {
    getWebContentsIdByTabIdMock.mockReturnValue(new Map([['page-1', 123]]))
    await expect(waitForAnyTabRegistration(1000)).resolves.toBeUndefined()
  })

  it('ignores stale guests when resolving worktree waits', async () => {
    getWebContentsIdByTabIdMock.mockReturnValue(new Map([['page-1', 123]]))
    getWorktreeIdForTabMock.mockReturnValue('worktree-1')
    webContentsFromIdMock.mockReturnValue({ isDestroyed: () => true })
    let resolved = false
    const wait = waitForWorktreeTabRegistration('worktree-1', 1000).then(() => {
      resolved = true
    })
    await Promise.resolve()
    expect(resolved).toBe(false)
    registerBrowserHandlers()
    const registerHandler = handleMock.mock.calls.find(
      ([channel]) => channel === 'browser:registerGuest'
    )?.[1] as RegistrationHandler
    expect(
      registerHandler(
        {
          sender: {
            id: 91,
            isDestroyed: () => false,
            getType: () => 'window',
            getURL: () => 'file:///renderer/index.html'
          } as Electron.WebContents
        },
        {
          browserPageId: 'page-1',
          workspaceId: 'workspace-1',
          worktreeId: 'worktree-1',
          webContentsId: 456
        }
      )
    ).toBe(true)
    await expect(wait).resolves.toBeUndefined()
    expect(resolved).toBe(true)
  })
})
