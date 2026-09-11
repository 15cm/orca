import { vi } from 'vitest'
import type { Mock } from 'vitest'
import type { Store } from '../persistence'

export type MockFn = Mock<(...args: never[]) => unknown>

export type RuntimeStub = {
  attachWindow: MockFn
  setNotifier: MockFn
  markRendererReloading: MockFn
  markRendererReloadCancelled: MockFn
  markGraphReloadFailed: MockFn
  markGraphUnavailable: MockFn
  resolveOwnerWindowIdForTabId: MockFn
  resolveOwnerWindowIdForWorktreeTab: MockFn
  resolveOwnerWindowIdForLeaf: MockFn
  resolveOwnerWindowIdForPtyId: MockFn
  resolveOwnerWindowIdForBrowserPageId: MockFn
  registerPtyOwnerWindow: MockFn
}

export function createStore(): Store & { flushPendingAsync: MockFn } {
  return {
    getProfileStorageDirectory: vi.fn(() => '/profile-a'),
    flushPendingAsync: vi.fn(() => Promise.resolve())
  } as unknown as Store & { flushPendingAsync: MockFn }
}

export function createRuntime(): RuntimeStub {
  return {
    attachWindow: vi.fn(),
    setNotifier: vi.fn(),
    markRendererReloading: vi.fn(),
    markRendererReloadCancelled: vi.fn(),
    markGraphReloadFailed: vi.fn(),
    markGraphUnavailable: vi.fn(),
    // Why: relays resolve the owning window before sending; null means "no owner yet",
    // which routes to the window in front — the single-window behavior most tests assert.
    resolveOwnerWindowIdForTabId: vi.fn(() => null),
    resolveOwnerWindowIdForWorktreeTab: vi.fn(() => null),
    resolveOwnerWindowIdForLeaf: vi.fn(() => null),
    resolveOwnerWindowIdForPtyId: vi.fn(() => null),
    resolveOwnerWindowIdForBrowserPageId: vi.fn(() => null),
    registerPtyOwnerWindow: vi.fn()
  }
}

export function getClosedHandlers(mainWindowOnMock: MockFn): (() => void)[] {
  return mainWindowOnMock.mock.calls
    .filter(([event]) => event === 'closed')
    .map(([, handler]) => handler as () => void)
}
