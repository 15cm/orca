import { beforeEach, describe, expect, it, vi } from 'vitest'
import { attachMainWindowServices } from './attach-main-window-services'
import { _resetMainWindowRegistryForTests, registerMainWindow } from './main-window-registry'
import {
  createRuntime,
  createStore,
  type MockFn
} from './attach-main-window-services-test-fixtures'
import type { RuntimeNotifier } from '../runtime/runtime-notifier-contract'

const { onMock, removeListenerMock, sendMock } = vi.hoisted(() => ({
  onMock: vi.fn(),
  removeListenerMock: vi.fn(),
  sendMock: vi.fn()
}))
vi.mock('electron', () => ({
  app: {},
  clipboard: {},
  ipcMain: {
    on: onMock,
    removeListener: removeListenerMock,
    removeAllListeners: vi.fn(),
    handle: vi.fn(),
    removeHandler: vi.fn()
  },
  powerMonitor: { on: vi.fn(), off: vi.fn() },
  systemPreferences: {
    askForMediaAccess: vi.fn(() => Promise.resolve(true)),
    getMediaAccessStatus: vi.fn()
  }
}))
vi.mock('../ipc/repos', () => ({ registerRepoHandlers: vi.fn() }))
vi.mock('../ipc/repos/repos-changed-notification', () => ({ setRepoRemoteClientNotifier: vi.fn() }))
vi.mock('../ipc/watched-worktree-catalog-notification', () => ({
  setWorktreeCatalogRemoteClientNotifier: vi.fn()
}))
vi.mock('../ipc/worktrees', () => ({ registerWorktreeHandlers: vi.fn() }))
vi.mock('../ipc/worktree-change-invalidators', () => ({ runWorktreeChangeInvalidators: vi.fn() }))
vi.mock('../ipc/pty', () => ({ getLocalPtyProvider: vi.fn(), registerPtyHandlers: vi.fn() }))
vi.mock('../memory/hydrate-local-pty-registry', () => ({ hydrateLocalPtyRegistryAtBoot: vi.fn() }))
vi.mock('../ipc/worktree-base-directory-watcher', () => ({
  setWorktreeBaseDirectoryWatcherSyncContext: vi.fn(),
  scheduleWorktreeBaseDirectoryWatcherSync: vi.fn()
}))
vi.mock('../browser/browser-manager', () => ({ browserManager: { unregisterAll: vi.fn() } }))
vi.mock('../updater', () => ({
  checkForUpdates: vi.fn(),
  getUpdateStatus: vi.fn(),
  quitAndInstall: vi.fn(),
  dismissNudge: vi.fn(),
  setupAutoUpdater: vi.fn()
}))
vi.mock('../macos-tcc-prompt-notice', () => ({
  acknowledgePendingTccPromptNotice: vi.fn(),
  consumePendingTccPromptNotice: vi.fn(),
  dismissTccPromptNotice: vi.fn(),
  releasePendingTccPromptNotice: vi.fn()
}))

type WindowStub = {
  id: number
  isDestroyed: MockFn
  on: MockFn
  once: MockFn
  webContents: Record<string, unknown> & { send: MockFn }
}
type RevealNotifier = {
  revealTerminalSession: (worktreeId: string, opts: unknown) => Promise<unknown>
}
function createWindow(id = 1, send = sendMock): WindowStub {
  return {
    id,
    isDestroyed: vi.fn(() => false),
    on: vi.fn(),
    once: vi.fn(),
    webContents: {
      id,
      getURL: vi.fn(() => 'file:///orca'),
      isDestroyed: vi.fn(() => false),
      isLoadingMainFrame: vi.fn(() => true),
      on: vi.fn(),
      send,
      reload: vi.fn(),
      session: { setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn() }
    }
  }
}
function closedHandlers(on: MockFn): (() => void)[] {
  return on.mock.calls
    .filter(([event]) => event === 'closed')
    .map(([, handler]) => handler as () => void)
}

describe('runtime window notifier relay', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    _resetMainWindowRegistryForTests()
  })

  it('clears notifier when owning window closes', () => {
    const on = vi.fn()
    const window = createWindow()
    window.on = on
    const runtime = createRuntime()
    attachMainWindowServices(window as never, createStore(), runtime as never)
    runtime.setNotifier.mockClear()
    closedHandlers(on).forEach((handler) => handler())
    expect(runtime.markGraphUnavailable).toHaveBeenCalledWith(1)
    expect(runtime.setNotifier).toHaveBeenCalledWith(null)
  })

  it('clears notifier after windows close in reverse order', () => {
    const runtime = createRuntime()
    const oldOn = vi.fn()
    const oldWindow = createWindow()
    oldWindow.on = oldOn
    registerMainWindow(oldWindow as never)
    attachMainWindowServices(oldWindow as never, createStore(), runtime as never)
    const newOn = vi.fn()
    const newWindow = createWindow(2)
    newWindow.on = newOn
    registerMainWindow(newWindow as never)
    attachMainWindowServices(newWindow as never, createStore(), runtime as never)
    runtime.setNotifier.mockClear()
    closedHandlers(newOn).forEach((handler) => handler())
    expect(runtime.setNotifier).not.toHaveBeenCalledWith(null)
    closedHandlers(oldOn).forEach((handler) => handler())
    expect(runtime.setNotifier).toHaveBeenCalledWith(null)
  })

  it('forwards broadcast and preferred notifications', () => {
    const window = createWindow()
    const runtime = createRuntime()
    attachMainWindowServices(window as never, createStore(), runtime as never)
    const notifier = runtime.setNotifier.mock.calls[0]?.[0]
    if (!notifier) {
      throw new Error('runtime notifier was not registered')
    }
    notifier.reposChanged()
    notifier.activateWorktree('repo-1', 'wt-1')
    expect(sendMock.mock.calls).toEqual([
      ['repos:changed'],
      ['ui:activateWorktree', { repoId: 'repo-1', worktreeId: 'wt-1' }]
    ])
  })

  it('uses the preferred window for owner-unknown startup and race notifications', () => {
    const firstSend = vi.fn()
    const secondSend = vi.fn()
    const firstWindow = createWindow(1, firstSend)
    const secondWindow = createWindow(2, secondSend)
    registerMainWindow(firstWindow as never)
    const runtime = createRuntime()
    attachMainWindowServices(firstWindow as never, createStore(), runtime as never)
    registerMainWindow(secondWindow as never)
    attachMainWindowServices(secondWindow as never, createStore(), runtime as never)
    const notifier = runtime.setNotifier.mock.calls.at(-1)?.[0] as RuntimeNotifier

    notifier.activateWorktree('repo-1', 'wt-1')
    notifier.createTerminal('wt-1', { title: 'startup' })
    notifier.openFile?.('wt-1', '/tmp/file', 'file')
    notifier.openDiff?.('wt-1', '/tmp/file', 'file', false)
    notifier.sleepWorktree('wt-1')
    notifier.resumeSleepingAgents?.('wt-1')
    notifier.clientHostedBrowserRowsChanged?.({ worktreeId: 'wt-1', rows: [] })
    notifier.terminalFitOverrideChanged('pty-1', 'desktop-fit', 80, 24)
    notifier.terminalDriverChanged('pty-1', { kind: 'desktop' })
    notifier.nativeChatLaunchDraftResolved?.('tab-1', { text: 'draft', createdAt: 1 })
    notifier.browserDriverChanged?.('page-1', { kind: 'desktop' })
    notifier.browserRemoteViewersChanged?.('page-1', true)

    expect(firstSend).not.toHaveBeenCalled()
    expect(secondSend).toHaveBeenCalledTimes(12)
    expect(secondSend.mock.calls.map(([channel]) => channel)).toEqual([
      'ui:activateWorktree',
      'ui:createTerminal',
      'ui:openFileFromMobile',
      'ui:openDiffFromMobile',
      'ui:sleepWorktree',
      'ui:resumeSleepingAgents',
      'runtime:clientHostedBrowserRowsChanged',
      'runtime:terminalFitOverrideChanged',
      'runtime:terminalDriverChanged',
      'runtime:nativeChatLaunchDraftResolved',
      'runtime:browserDriverChanged',
      'runtime:browserRemoteViewersChanged'
    ])
  })

  it('drops strict owner-only notifications and throws for strict renderer requests when owner is unknown', () => {
    const runtime = createRuntime()
    const window = createWindow()
    attachMainWindowServices(window as never, createStore(), runtime as never)
    const notifier = runtime.setNotifier.mock.calls.at(-1)?.[0] as RuntimeNotifier

    notifier.resolveLegacyWorkerTerminalRecovery?.('pane-1', 'exited', 'pty-1')
    notifier.splitTerminal('tab-1', 1, { direction: 'horizontal' })
    notifier.renameTerminal('tab-1', 'renamed')
    notifier.focusTerminal('tab-1', 'wt-1')
    notifier.focusEditorTab?.('tab-1', 'wt-1')
    notifier.moveSessionTab?.('wt-1', {
      kind: 'reorder',
      tabId: 'tab-1',
      targetGroupId: 'group-1',
      tabOrder: ['tab-1']
    })
    notifier.closeTerminal('tab-1', 1)

    expect(sendMock).not.toHaveBeenCalled()
    expect(() => notifier.closeSessionTab?.('tab-1', 'wt-1')).toThrow('runtime_unavailable')
    expect(() => notifier.closeTerminalTab?.('tab-1')).toThrow('runtime_unavailable')
    expect(() => notifier.readMobileMarkdownTab?.('wt-1', 'tab-1')).toThrow('runtime_unavailable')
    expect(() => notifier.saveMobileMarkdownTab?.('wt-1', 'tab-1', 'v1', 'text')).toThrow(
      'runtime_unavailable'
    )
  })

  it('accepts replies only from targeted renderer', async () => {
    const window = createWindow()
    const runtime = createRuntime()
    attachMainWindowServices(window as never, createStore(), runtime as never)
    const notifier = runtime.setNotifier.mock.calls[0][0] as RevealNotifier
    const promise = notifier.revealTerminalSession('wt-1', { ptyId: 'pty-1', title: 'SSH tmux' })
    const payload = sendMock.mock.calls.find(([channel]) => channel === 'ui:createTerminal')?.[1]
    const handler = onMock.mock.calls.find(
      ([channel]) => channel === 'terminal:tabCreateReply'
    )?.[1]
    handler?.({ sender: { send: vi.fn() } }, { requestId: payload.requestId, error: 'spoofed' })
    handler?.(
      { sender: window.webContents },
      { requestId: payload.requestId, tabId: 'tab-1', title: 'SSH tmux' }
    )
    await expect(promise).resolves.toEqual({ tabId: 'tab-1', title: 'SSH tmux' })
    expect(removeListenerMock).toHaveBeenCalledWith('terminal:tabCreateReply', handler)
  })

  it('requires exact identity for recovered worker reveals', async () => {
    const window = createWindow()
    const runtime = createRuntime()
    attachMainWindowServices(window as never, createStore(), runtime as never)
    const notifier = runtime.setNotifier.mock.calls[0][0] as RevealNotifier
    const opts = {
      ptyId: 'pty-worker',
      tabId: 'tab-worker',
      leafId: 'leaf-worker',
      expectedProcessIdentity: { terminalHandle: 'term', incarnationId: 'inc' }
    }
    const mismatch = notifier.revealTerminalSession('worktree-1', opts)
    const mismatchPayload = sendMock.mock.calls.at(-1)?.[1]
    const mismatchHandler = onMock.mock.calls.findLast(
      ([channel]) => channel === 'terminal:tabCreateReply'
    )?.[1]
    mismatchHandler?.(
      { sender: window.webContents },
      {
        requestId: mismatchPayload.requestId,
        tabId: 'tab-worker',
        identity: {
          worktreeId: 'worktree-1',
          tabId: 'tab-worker',
          leafId: 'leaf-worker',
          ptyId: 'replacement'
        }
      }
    )
    await expect(mismatch).rejects.toThrow('terminal_reveal_identity_mismatch')
  })
})
