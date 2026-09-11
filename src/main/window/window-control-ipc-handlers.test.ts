import { beforeEach, describe, expect, it, vi } from 'vitest'

const { handleMock, ipcOnMock, getMainWindowForWebContentsMock } = vi.hoisted(() => ({
  handleMock: vi.fn(),
  ipcOnMock: vi.fn(),
  getMainWindowForWebContentsMock: vi.fn()
}))

vi.mock('electron', () => ({
  Menu: { getApplicationMenu: vi.fn() },
  ipcMain: { handle: handleMock, on: ipcOnMock }
}))
vi.mock('./main-window-registry', () => ({
  getMainWindowForWebContents: getMainWindowForWebContentsMock
}))

import { registerWindowControlIpcHandlers } from './window-control-ipc-handlers'
import { _resetWindowControlIpcHandlersForTests } from './window-control-registration-latch'

describe('window maximized IPC handler', () => {
  beforeEach(() => {
    handleMock.mockReset()
    ipcOnMock.mockReset()
    getMainWindowForWebContentsMock.mockReset()
    _resetWindowControlIpcHandlersForTests()
  })

  it('registers once and reads the sender window state', () => {
    const windowA = { isMaximized: vi.fn(() => true) }
    const windowB = { isMaximized: vi.fn(() => false) }
    const senderA = {}
    const senderB = {}
    getMainWindowForWebContentsMock.mockImplementation((sender: object) =>
      sender === senderA ? windowA : windowB
    )

    registerWindowControlIpcHandlers()
    registerWindowControlIpcHandlers()

    expect(handleMock).toHaveBeenCalledTimes(1)
    const handler = handleMock.mock.calls[0]?.[1] as (event: { sender: object }) => boolean
    expect(handler({ sender: senderA })).toBe(true)
    expect(handler({ sender: senderB })).toBe(false)
    expect(windowA.isMaximized).toHaveBeenCalledTimes(1)
    expect(windowB.isMaximized).toHaveBeenCalledTimes(1)
  })

  it('returns false when the sender has no live registered window', () => {
    getMainWindowForWebContentsMock.mockReturnValue(null)
    registerWindowControlIpcHandlers()

    const handler = handleMock.mock.calls[0]?.[1] as (event: { sender: object }) => boolean
    expect(handler({ sender: {} })).toBe(false)
  })

  it('routes controls to the window belonging to the sender', () => {
    const windowA = {
      isDestroyed: vi.fn(() => false),
      isMaximized: vi.fn(() => false),
      minimize: vi.fn(),
      maximize: vi.fn()
    }
    const windowB = {
      isDestroyed: vi.fn(() => false),
      isMaximized: vi.fn(() => true),
      unmaximize: vi.fn()
    }
    const senderA = {}
    const senderB = {}
    getMainWindowForWebContentsMock.mockImplementation((sender: object) =>
      sender === senderA ? windowA : windowB
    )

    registerWindowControlIpcHandlers()
    const listeners = new Map(
      ipcOnMock.mock.calls.map(([channel, listener]) => [channel, listener] as const)
    )

    listeners.get('window:minimize')?.({ sender: senderA })
    listeners.get('window:maximize')?.({ sender: senderB })

    expect(windowA.minimize).toHaveBeenCalledOnce()
    expect(windowB.unmaximize).toHaveBeenCalledOnce()
    expect(windowA.maximize).not.toHaveBeenCalled()
  })
})
