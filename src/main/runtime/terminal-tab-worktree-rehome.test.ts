import { describe, expect, it, vi } from 'vitest'
import { makePaneKey } from '../../shared/stable-pane-id'
import { OrcaRuntimeService } from './orca-runtime'
import { rehomeTerminalTabWorktreeRecords } from './terminal-tab-worktree-rehome'

const TASKS = 'repo-1::/tmp/perc-tasks'
const CLOSED = 'repo-1::/tmp/perc-closed'
const TAB_ID = 'tab-agent'
const OTHER_TAB_ID = 'tab-other'
const LEAF_ID = '11111111-2222-4333-8444-555555555555'
const PTY_ID = 'pty-agent'
const PANE_KEY = makePaneKey(TAB_ID, LEAF_ID)

function makeRecords() {
  return {
    tabs: new Map([[TAB_ID, { tabId: TAB_ID, worktreeId: TASKS }]]),
    leaves: new Map([
      [`${TAB_ID}::${LEAF_ID}`, { tabId: TAB_ID, worktreeId: TASKS, ptyId: PTY_ID }],
      [`${OTHER_TAB_ID}::other`, { tabId: OTHER_TAB_ID, worktreeId: TASKS, ptyId: 'pty-other' }]
    ]),
    ptys: new Map([
      [PTY_ID, { ptyId: PTY_ID, tabId: TAB_ID, worktreeId: TASKS }],
      ['pty-other', { ptyId: 'pty-other', tabId: OTHER_TAB_ID, worktreeId: TASKS }]
    ])
  }
}

describe('rehomeTerminalTabWorktreeRecords', () => {
  it('re-keys the tab, its leaves and its PTYs, and reports the moved PTYs', () => {
    const records = makeRecords()

    expect(rehomeTerminalTabWorktreeRecords(records, TAB_ID, CLOSED)).toEqual([PTY_ID])
    expect(records.tabs.get(TAB_ID)?.worktreeId).toBe(CLOSED)
    expect(records.leaves.get(`${TAB_ID}::${LEAF_ID}`)?.worktreeId).toBe(CLOSED)
    expect(records.ptys.get(PTY_ID)?.worktreeId).toBe(CLOSED)
  })

  it('leaves other tabs in the source workspace', () => {
    const records = makeRecords()

    rehomeTerminalTabWorktreeRecords(records, TAB_ID, CLOSED)

    expect(records.leaves.get(`${OTHER_TAB_ID}::other`)?.worktreeId).toBe(TASKS)
    expect(records.ptys.get('pty-other')?.worktreeId).toBe(TASKS)
  })

  it('re-keys a PTY whose panes are unmounted and therefore have no leaf record', () => {
    const records = makeRecords()
    records.leaves.delete(`${TAB_ID}::${LEAF_ID}`)

    expect(rehomeTerminalTabWorktreeRecords(records, TAB_ID, CLOSED)).toEqual([PTY_ID])
    expect(records.ptys.get(PTY_ID)?.worktreeId).toBe(CLOSED)
  })
})

describe('OrcaRuntimeService.rehomeTerminalTabWorktree', () => {
  function createRuntime() {
    const controller = { write: vi.fn(() => true), kill: vi.fn() }
    const runtime = new OrcaRuntimeService(null)
    runtime.setPtyController(controller as never)
    runtime.registerPty(PTY_ID, TASKS, null, { tabId: TAB_ID, leafId: LEAF_ID })
    runtime.attachWindow(1)
    runtime.syncWindowGraph(1, {
      tabs: [
        { tabId: TAB_ID, worktreeId: TASKS, title: 'Agent', activeLeafId: LEAF_ID, layout: null }
      ],
      leaves: [
        { tabId: TAB_ID, worktreeId: TASKS, leafId: LEAF_ID, paneRuntimeId: 1, ptyId: PTY_ID }
      ]
    })
    return { runtime, controller }
  }

  it('moves the live pane to the destination workspace without touching the process', () => {
    const { runtime, controller } = createRuntime()
    expect(runtime.resolveTerminalPane(PANE_KEY, TASKS).ptyId).toBe(PTY_ID)

    expect(runtime.rehomeTerminalTabWorktree(TAB_ID, CLOSED)).toEqual({ rehomedPtyIds: [PTY_ID] })

    const resolved = runtime.resolveTerminalPane(PANE_KEY, CLOSED)
    expect(resolved.ptyId).toBe(PTY_ID)
    expect(resolved.worktreeId).toBe(CLOSED)
    expect(controller.kill).not.toHaveBeenCalled()
  })

  it('stops answering for the workspace the tab left', () => {
    const { runtime } = createRuntime()

    runtime.rehomeTerminalTabWorktree(TAB_ID, CLOSED)

    expect(() => runtime.resolveTerminalPane(PANE_KEY, TASKS)).toThrow('terminal_not_found')
  })

  it('is a no-op for a tab the runtime does not track', () => {
    const { runtime, controller } = createRuntime()

    expect(runtime.rehomeTerminalTabWorktree('tab-unknown', CLOSED)).toEqual({ rehomedPtyIds: [] })
    expect(runtime.resolveTerminalPane(PANE_KEY, TASKS).ptyId).toBe(PTY_ID)
    expect(controller.kill).not.toHaveBeenCalled()
  })
})
