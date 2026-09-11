import { beforeEach, describe, expect, it, vi } from 'vitest'

const { removeHandlerMock, handleMock, clipboardReadTextMock } = vi.hoisted(() => ({
  removeHandlerMock: vi.fn(),
  handleMock: vi.fn(),
  clipboardReadTextMock: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp') },
  BrowserWindow: { fromWebContents: vi.fn(() => null) },
  clipboard: {
    readText: clipboardReadTextMock,
    readBuffer: vi.fn(),
    writeText: vi.fn(),
    readImage: vi.fn(),
    writeImage: vi.fn(),
    writeBuffer: vi.fn()
  },
  ipcMain: { removeHandler: removeHandlerMock, handle: handleMock },
  nativeImage: { createFromBuffer: vi.fn() }
}))

vi.mock('./dashboard-popout-window', () => ({ isDashboardPopoutRenderer: () => false }))

import {
  clearTrustedClipboardRendererWebContentsId,
  registerClipboardHandlers,
  setTrustedClipboardRendererWebContentsId
} from './clipboard-ipc-handlers'

function getReadTextHandler(): (event: unknown) => unknown {
  const registration = handleMock.mock.calls.findLast(
    ([channel]) => channel === 'clipboard:readText'
  )
  expect(registration).toBeTruthy()
  return registration![1] as (event: unknown) => unknown
}

function clipboardEvent(id: number): { sender: unknown } {
  return {
    sender: {
      id,
      isDestroyed: () => false,
      getType: () => 'window',
      getURL: () => 'file:///renderer/index.html'
    }
  }
}

describe('clipboard IPC trust across main windows', () => {
  beforeEach(() => {
    handleMock.mockReset()
    removeHandlerMock.mockReset()
    clipboardReadTextMock.mockReset()
    setTrustedClipboardRendererWebContentsId(null)
  })

  it('trusts every registered main-window renderer until its window closes', async () => {
    setTrustedClipboardRendererWebContentsId(17)
    setTrustedClipboardRendererWebContentsId(42)
    clipboardReadTextMock.mockReturnValue('shared clipboard')
    registerClipboardHandlers({} as never)

    const readText = getReadTextHandler()

    await expect(readText(clipboardEvent(17))).resolves.toBe('shared clipboard')
    await expect(readText(clipboardEvent(42))).resolves.toBe('shared clipboard')

    clearTrustedClipboardRendererWebContentsId(42)

    await expect(readText(clipboardEvent(17))).resolves.toBe('shared clipboard')
    await expect(readText(clipboardEvent(42))).rejects.toThrow('Unauthorized clipboard IPC sender')
  })
})
