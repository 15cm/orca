import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  removeHandlerMock,
  handleMock,
  registerGuestMock,
  attachGuestPoliciesMock,
  unregisterGuestMock,
  getGuestWebContentsIdMock,
  getRendererWebContentsIdMock,
  getWebContentsIdByTabIdMock,
  getWorktreeIdForTabMock,
  getAuthorizedGuestMock,
  setGrabModeMock,
  openDevToolsMock,
  setAnnotationViewportBridgeMock,
  cancelDownloadMock,
  proceedCertificateMock,
  browserWindowFromWebContentsMock,
  webContentsFromIdMock,
  getMainWindowForWebContentsMock
} = vi.hoisted(() => ({
  removeHandlerMock: vi.fn(),
  handleMock: vi.fn(),
  registerGuestMock: vi.fn(),
  attachGuestPoliciesMock: vi.fn(),
  unregisterGuestMock: vi.fn(),
  getGuestWebContentsIdMock: vi.fn(),
  getRendererWebContentsIdMock: vi.fn(),
  getWebContentsIdByTabIdMock: vi.fn(() => new Map()),
  getWorktreeIdForTabMock: vi.fn(),
  getAuthorizedGuestMock: vi.fn(),
  setGrabModeMock: vi.fn(),
  openDevToolsMock: vi.fn().mockResolvedValue(true),
  setAnnotationViewportBridgeMock: vi.fn().mockResolvedValue(true),
  cancelDownloadMock: vi.fn(),
  proceedCertificateMock: vi.fn(),
  browserWindowFromWebContentsMock: vi.fn(),
  webContentsFromIdMock: vi.fn(),
  getMainWindowForWebContentsMock: vi.fn()
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    fromWebContents: browserWindowFromWebContentsMock
  },
  ipcMain: {
    removeHandler: removeHandlerMock,
    handle: handleMock
  },
  webContents: {
    fromId: webContentsFromIdMock
  }
}))

vi.mock('../browser/browser-manager', () => ({
  browserCertificateTrustController: {
    proceed: proceedCertificateMock
  },
  browserManager: {
    registerGuest: registerGuestMock,
    attachGuestPolicies: attachGuestPoliciesMock,
    unregisterGuest: unregisterGuestMock,
    getGuestWebContentsId: getGuestWebContentsIdMock,
    getRendererWebContentsId: getRendererWebContentsIdMock,
    getWebContentsIdByTabId: getWebContentsIdByTabIdMock,
    getWorktreeIdForTab: getWorktreeIdForTabMock,
    getAuthorizedGuest: getAuthorizedGuestMock,
    setGrabMode: setGrabModeMock,
    openDevTools: openDevToolsMock,
    setAnnotationViewportBridge: setAnnotationViewportBridgeMock,
    cancelDownload: cancelDownloadMock
  }
}))

vi.mock('../window/main-window-registry', () => ({
  getMainWindowForWebContents: getMainWindowForWebContentsMock
}))

import { registerBrowserHandlers } from './browser'
import {
  removeTrustedBrowserRendererWebContentsId,
  setTrustedBrowserRendererWebContentsId
} from './browser-renderer-trust'

type GuestRegistrationArgs = {
  browserPageId: string
  workspaceId: string
  worktreeId: string
  webContentsId: number
}
type GuestRegistrationHandler = (
  event: { sender: Electron.WebContents },
  args: GuestRegistrationArgs
) => boolean

function trustedSender(id: number): Electron.WebContents {
  return {
    id,
    isDestroyed: () => false,
    getType: () => 'window',
    getURL: () => 'file:///renderer/index.html'
  } as Electron.WebContents
}

function getHandler(channel: string): GuestRegistrationHandler {
  return handleMock.mock.calls.find(([name]) => name === channel)?.[1] as GuestRegistrationHandler
}

describe('browser IPC ownership across main windows', () => {
  beforeEach(() => {
    vi.stubEnv('ELECTRON_RENDERER_URL', '')
    removeHandlerMock.mockReset()
    handleMock.mockReset()
    registerGuestMock.mockReset()
    registerGuestMock.mockReturnValue(true)
    getGuestWebContentsIdMock.mockReset()
    getRendererWebContentsIdMock.mockReset()
    getRendererWebContentsIdMock.mockReturnValue(91)
    getWebContentsIdByTabIdMock.mockReset()
    getWebContentsIdByTabIdMock.mockReturnValue(new Map())
    getWorktreeIdForTabMock.mockReset()
    webContentsFromIdMock.mockReset()
    webContentsFromIdMock.mockReturnValue({ isDestroyed: () => false })
    getMainWindowForWebContentsMock.mockReset()
    getMainWindowForWebContentsMock.mockReturnValue({})
    setTrustedBrowserRendererWebContentsId(null)
  })

  it('does not fall back to URL trust after explicit trusted renderers are removed', () => {
    setTrustedBrowserRendererWebContentsId(91)
    removeTrustedBrowserRendererWebContentsId(91)
    registerBrowserHandlers()

    const result = getHandler('browser:registerGuest')(
      { sender: trustedSender(91) },
      {
        browserPageId: 'page-closed-window',
        workspaceId: 'workspace-1',
        worktreeId: 'worktree-1',
        webContentsId: 123
      }
    )

    expect(result).toBe(false)
    expect(registerGuestMock).not.toHaveBeenCalled()
  })

  it('rejects a renderer trusted only while its window is still registered', () => {
    setTrustedBrowserRendererWebContentsId(91)
    getMainWindowForWebContentsMock.mockReturnValue(null)
    registerBrowserHandlers()

    const result = getHandler('browser:registerGuest')(
      { sender: trustedSender(91) },
      {
        browserPageId: 'page-1',
        workspaceId: 'workspace-1',
        worktreeId: 'worktree-1',
        webContentsId: 123
      }
    )

    expect(result).toBe(false)
  })

  it('refuses to take a live page away from the renderer that owns it', () => {
    getRendererWebContentsIdMock.mockReturnValue(90)
    getGuestWebContentsIdMock.mockReturnValue(123)
    webContentsFromIdMock.mockReturnValue({ isDestroyed: () => false })
    registerBrowserHandlers()

    const result = getHandler('browser:registerGuest')(
      { sender: trustedSender(91) },
      {
        browserPageId: 'page-1',
        workspaceId: 'workspace-1',
        worktreeId: 'worktree-1',
        webContentsId: 456
      }
    )

    expect(result).toBe(false)
    expect(registerGuestMock).not.toHaveBeenCalled()
  })

  it('allows another renderer to register a page after the previous guest is gone', () => {
    getRendererWebContentsIdMock.mockReturnValue(90)
    getGuestWebContentsIdMock.mockReturnValue(123)
    webContentsFromIdMock.mockReturnValue({ isDestroyed: () => true })
    registerBrowserHandlers()

    const result = getHandler('browser:registerGuest')(
      { sender: trustedSender(91) },
      {
        browserPageId: 'page-1',
        workspaceId: 'workspace-1',
        worktreeId: 'worktree-1',
        webContentsId: 456
      }
    )

    expect(result).toBe(true)
    expect(registerGuestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        browserPageId: 'page-1',
        rendererWebContentsId: 91,
        webContentsId: 456
      })
    )
  })

  it('refuses to unregister a page owned by another window renderer', () => {
    getRendererWebContentsIdMock.mockReturnValue(90)
    registerBrowserHandlers()

    const result = getHandler('browser:unregisterGuest')({ sender: trustedSender(91) }, {
      browserPageId: 'page-1'
    } as GuestRegistrationArgs)

    expect(result).toBe(false)
    expect(unregisterGuestMock).not.toHaveBeenCalled()
  })
})
