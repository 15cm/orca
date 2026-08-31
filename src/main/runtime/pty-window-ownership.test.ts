import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceSessionState } from '../../shared/workspace-session-state-types'
import type { ExecutionHostId } from '../../shared/execution-host'
import { OrcaRuntimeService } from './orca-runtime'

const WORKTREE = 'repo::/worktree'
const session: WorkspaceSessionState = {
  activeRepoId: 'repo',
  activeWorktreeId: WORKTREE,
  activeTabId: null,
  tabsByWorktree: {},
  terminalLayoutsByTabId: {}
}

function makeRuntime() {
  const changed = vi.fn()
  const runtime = new OrcaRuntimeService({
    getWorkspaceSession: () => session,
    getRepos: () => [],
    getSettings: () => ({})
  } as never)
  runtime.setNotifier({ ptyOwnershipChanged: changed } as never)
  return { runtime, changed }
}

function graph(
  selected: boolean | undefined,
  activeLeafId = 'leaf-a',
  executionHostId?: ExecutionHostId,
  ptyId = 'pty-a'
) {
  return {
    tabs: [
      {
        tabId: 'tab-a',
        worktreeId: WORKTREE,
        title: 'Terminal',
        ...(executionHostId ? { executionHostId } : {}),
        ...(selected === undefined ? {} : { selected }),
        activeLeafId,
        layout: null
      }
    ],
    leaves: [
      {
        tabId: 'tab-a',
        worktreeId: WORKTREE,
        ...(executionHostId ? { executionHostId } : {}),
        leafId: 'leaf-a',
        paneRuntimeId: 1,
        ptyId
      }
    ],
    rendererGeneration: `generation-${selected}`
  }
}

describe('PTY window ownership eligibility', () => {
  it('requires selected top-level tab in addition to active leaf', () => {
    const { runtime, changed } = makeRuntime()
    runtime.syncWindowGraph(1, graph(false))
    expect(runtime.claimPtyOwnershipForWindowPty(1, 'pty-a')).toBe(false)
    runtime.syncWindowGraph(1, graph(true))
    expect(runtime.claimPtyOwnershipForWindowPty(1, 'pty-a')).toBe(true)
    expect(changed).toHaveBeenCalledTimes(0)
  })

  it('accepts legacy payloads that omit optional selected field', () => {
    const { runtime } = makeRuntime()
    runtime.syncWindowGraph(1, graph(undefined))
    expect(runtime.claimPtyOwnershipForWindowPty(1, 'pty-a')).toBe(true)
  })

  it('does not notify when focused duplicate reclaims its existing owner', () => {
    const { runtime, changed } = makeRuntime()
    runtime.syncWindowGraph(1, graph(true))
    expect(runtime.claimPtyOwnershipForWindowPty(1, 'pty-a')).toBe(true)
    expect(runtime.claimPtyOwnershipForWindowPty(1, 'pty-a')).toBe(true)
    expect(changed).toHaveBeenCalledTimes(0)
  })

  it('transfers only after an eligible duplicate is published', () => {
    const { runtime, changed } = makeRuntime()
    runtime.syncWindowGraph(1, graph(true))
    expect(runtime.claimPtyOwnershipForWindowPty(1, 'pty-a')).toBe(true)
    runtime.syncWindowGraph(2, graph(false))
    expect(runtime.claimPtyOwnershipForWindowPty(2, 'pty-a')).toBe(false)
    runtime.syncWindowGraph(2, graph(true))
    expect(runtime.claimPtyOwnershipForWindowPty(2, 'pty-a')).toBe(true)
    expect(changed).toHaveBeenLastCalledWith('pty-a', 2)
    expect(changed).toHaveBeenCalledTimes(1)
  })

  it('falls back deterministically when the transferred renderer graph disappears', () => {
    const { runtime, changed } = makeRuntime()
    runtime.syncWindowGraph(1, graph(true))
    runtime.syncWindowGraph(2, graph(true))
    expect(runtime.claimPtyOwnershipForWindowPty(2, 'pty-a')).toBe(true)
    runtime.syncWindowGraph(2, { tabs: [], leaves: [], rendererGeneration: 'generation-reload' })
    expect(runtime.resolveOwnerWindowIdForPtyId('pty-a')).toBe(1)
    expect(changed).toHaveBeenCalled()
  })

  it('keeps equal workspace tab and leaf IDs isolated by optional execution host', () => {
    const { runtime } = makeRuntime()
    runtime.syncWindowGraph(1, graph(true, 'leaf-a', 'local'))
    runtime.syncWindowGraph(2, graph(true, 'leaf-a', 'ssh:host-a', 'pty-b'))
    expect(runtime.claimPtyOwnershipForWindowPty(1, 'pty-a')).toBe(true)
    expect(runtime.claimPtyOwnershipForWindowPty(2, 'pty-b')).toBe(true)
    expect(runtime.resolveOwnerWindowIdForPtyId('pty-a')).toBe(1)
    expect(runtime.resolveOwnerWindowIdForPtyId('pty-b')).toBe(2)
  })

  it('does not assign ownership from an unselected mobile snapshot', () => {
    const { runtime } = makeRuntime()
    runtime.syncWindowGraph(1, {
      tabs: [],
      leaves: [],
      mobileSessionTabs: [
        {
          worktree: WORKTREE,
          snapshotVersion: 1,
          publicationEpoch: 'epoch-1',
          activeGroupId: null,
          activeTabId: null,
          activeTabType: 'terminal',
          tabs: [
            {
              type: 'terminal',
              id: 'tab-a',
              title: 'Terminal',
              parentTabId: 'tab-a',
              leafId: 'leaf-a',
              ptyId: 'pty-mobile',
              isActive: false
            }
          ]
        }
      ]
    })
    expect(runtime.resolveOwnerWindowIdForPtyId('pty-mobile')).toBeNull()
  })
})
