import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getDefaultWorkspaceSession } from '../../shared/constants'
import type { WorkspaceSessionState } from '../../shared/workspace-session-state-types'
import type { Store } from '../persistence'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  owned: new Set<string>()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((name: string, handler: (...args: unknown[]) => unknown) =>
      mocks.handlers.set(name, handler)
    ),
    on: vi.fn()
  }
}))
vi.mock('../window/window-view-state-registry', () => ({
  resolveWindowScopeForWebContents: vi.fn(() => null)
}))
vi.mock('../window/window-session-ownership', () => ({
  ownedSessionKeysForWindow: vi.fn(() => mocks.owned)
}))
vi.mock('../window/project-window-session-focus', () => ({
  withProjectWindowFocus: vi.fn((s) => s)
}))
vi.mock('../runtime/workspace-session-terminal-membership-authority', () => ({
  advanceTerminalTopologyRevision: vi.fn((s: WorkspaceSessionState, worktreeId: string) => ({
    ...s,
    terminalTopologyRevisionByRepoId: {
      ...s.terminalTopologyRevisionByRepoId,
      [worktreeId.split('::')[0]!]: 1
    }
  }))
}))

import { registerSessionHandlers } from './session'

const worktreeId = 'repo-1::/tmp/wt'
const tab = {
  id: 'tab-1',
  worktreeId,
  title: 'Terminal',
  ptyId: null,
  sortOrder: 0,
  createdAt: 1,
  customTitle: null,
  color: null
}

function session(): WorkspaceSessionState {
  return { ...getDefaultWorkspaceSession(), tabsByWorktree: { [worktreeId]: [tab] } }
}

describe('session:closeTerminalTab', () => {
  beforeEach(() => {
    mocks.handlers.clear()
    mocks.owned.clear()
  })

  it('writes requested host partition, advances fence, and flushes after write', () => {
    const current = session()
    const writes: unknown[] = []
    const store = {
      getWorkspaceSession: vi.fn(() => current),
      setWorkspaceSession: vi.fn((value) => writes.push(value)),
      flushOrThrow: vi.fn()
    } as unknown as Store
    registerSessionHandlers(store)
    const result = mocks.handlers.get('session:closeTerminalTab')!(
      { sender: { id: 1 } },
      { worktreeId, tabId: 'tab-1' },
      'ssh:build'
    )
    expect(result).toEqual({ closed: true, pinned: false })
    expect(store.setWorkspaceSession).toHaveBeenCalledWith(
      expect.objectContaining({ terminalTopologyRevisionByRepoId: { 'repo-1': 1 } }),
      'ssh:build',
      mocks.owned
    )
    expect(writes[0]).toMatchObject({ tabsByWorktree: { [worktreeId]: [] } })
    expect(store.flushOrThrow).toHaveBeenCalledOnce()
  })

  it('rolls back authoritative memory when flush fails', () => {
    const current = session()
    let authoritative = current
    const store = {
      getWorkspaceSession: vi.fn(() => authoritative),
      setWorkspaceSession: vi.fn((value) => {
        authoritative = value
      }),
      flushOrThrow: vi.fn(() => {
        throw new Error('disk full')
      })
    } as unknown as Store
    registerSessionHandlers(store)
    expect(() =>
      mocks.handlers.get('session:closeTerminalTab')!(
        { sender: { id: 1 } },
        { worktreeId, tabId: 'tab-1' },
        'local'
      )
    ).toThrow('disk full')
    expect(authoritative.tabsByWorktree[worktreeId]).toHaveLength(1)
  })

  it('treats missing tab idempotently and rejects unconfirmed pinned tabs', () => {
    const current = session()
    current.tabsByWorktree[worktreeId]![0]!.isPinned = true
    const store = {
      getWorkspaceSession: vi.fn(() => current),
      setWorkspaceSession: vi.fn(),
      flushOrThrow: vi.fn()
    } as unknown as Store
    registerSessionHandlers(store)
    const handler = mocks.handlers.get('session:closeTerminalTab')!
    expect(handler({ sender: { id: 1 } }, { worktreeId, tabId: 'missing' }, 'local')).toEqual({
      closed: false,
      pinned: false
    })
    expect(handler({ sender: { id: 1 } }, { worktreeId, tabId: 'tab-1' }, 'local')).toEqual({
      closed: false,
      pinned: true
    })
    expect(store.setWorkspaceSession).not.toHaveBeenCalled()
  })
})
