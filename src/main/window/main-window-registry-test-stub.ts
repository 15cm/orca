/** In-memory stand-in for the main-window registry, so suites that exercise renderer
 *  relays can drive several windows without constructing real BrowserWindows. */
export type StubMainWindow = {
  id: number
  isDestroyed: () => boolean
  webContents: { id?: number; send?: (...args: unknown[]) => void }
}

export const stubMainWindows: StubMainWindow[] = []

function liveStubWindows(): StubMainWindow[] {
  return stubMainWindows.filter((window) => !window.isDestroyed())
}

export function resetStubMainWindows(): void {
  stubMainWindows.length = 0
}

export function mainWindowRegistryStub(): Record<string, unknown> {
  return {
    registerMainWindow: (window: StubMainWindow) => {
      stubMainWindows.push(window)
    },
    getMainWindowForWebContents: (sender: unknown) =>
      liveStubWindows().find((window) => window.webContents === sender) ?? null,
    getMainWindowById: (id: number) => liveStubWindows().find((window) => window.id === id) ?? null,
    getRegisteredMainWindow: (window: unknown) =>
      liveStubWindows().find((candidate) => candidate === window) ?? null,
    getFocusedOrLastActiveMainWindow: () => liveStubWindows().at(-1) ?? null,
    getMainWindows: () => liveStubWindows(),
    hasLiveMainWindows: () => liveStubWindows().length > 0,
    hasVisibleMainWindow: () => liveStubWindows().length > 0,
    sendToWindow: (window: StubMainWindow, channel: string, ...args: unknown[]) =>
      window.webContents.send?.(channel, ...args),
    broadcastToMainWindows: (channel: string, ...args: unknown[]) => {
      for (const window of liveStubWindows()) {
        window.webContents.send?.(channel, ...args)
      }
    }
  }
}
