import { describe, expect, it } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'
import { makePaneKey } from '../../../../shared/stable-pane-id'
import { createTestStore, makeTab, makeUnifiedTab, makeWorktree } from './store-test-helpers'
import { projectMissingGeneratedTabTitlesFromAgentStatuses } from './agent-status-generated-title-projection'

const WORKTREE_ID = 'repo1::/path/wt1'
const LEAF_ID = '11111111-1111-4111-8111-111111111111'

function seedStore() {
  const store = createTestStore()
  const tab = makeTab({ id: 'tab-1', worktreeId: WORKTREE_ID, title: 'Codex ready' })
  store.setState({
    tabsByWorktree: { [WORKTREE_ID]: [tab] },
    unifiedTabsByWorktree: {
      [WORKTREE_ID]: [makeUnifiedTab({ id: tab.id, groupId: 'group-1', worktreeId: WORKTREE_ID })]
    },
    worktreesByRepo: {
      repo1: [makeWorktree({ id: WORKTREE_ID, repoId: 'repo1', path: '/path/wt1' })]
    },
    settings: null
  })
  return { store, paneKey: makePaneKey(tab.id, LEAF_ID) }
}

describe('agent status generated-title hydration projection', () => {
  it('backfills stored status prompts after settings hydrate, including unified labels', () => {
    const { store, paneKey } = seedStore()
    store.getState().setAgentStatus(paneKey, {
      state: 'working',
      prompt: 'Refactor the auth middleware to use JWT tokens',
      agentType: 'codex'
    })
    expect(store.getState().tabsByWorktree[WORKTREE_ID]![0]!.generatedTitle).toBeUndefined()

    store.setState({
      settings: { ...getDefaultSettings('/tmp'), tabAutoGenerateTitle: true }
    })
    const updates = projectMissingGeneratedTabTitlesFromAgentStatuses(store.getState())
    store.getState().setGeneratedTabTitlesFromAgentPrompts(updates)

    expect(store.getState().tabsByWorktree[WORKTREE_ID]![0]!.generatedTitle).toBe(
      'Refactor the auth middleware to use JWT'
    )
    expect(store.getState().unifiedTabsByWorktree[WORKTREE_ID]![0]!.generatedLabel).toBe(
      'Refactor the auth middleware to use JWT'
    )
    expect(projectMissingGeneratedTabTitlesFromAgentStatuses(store.getState())).toEqual([])
  })

  it.each([
    ['disabled setting', false],
    ['custom title', true]
  ])('does not overwrite %s', (_caseName, customTitle) => {
    const { store, paneKey } = seedStore()
    if (customTitle) {
      store.setState({
        tabsByWorktree: {
          [WORKTREE_ID]: [makeTab({ id: 'tab-1', worktreeId: WORKTREE_ID, customTitle: 'Keep me' })]
        }
      })
    }
    store.getState().setAgentStatus(paneKey, {
      state: 'working',
      prompt: 'Do not replace this title',
      agentType: 'codex'
    })
    store.setState({
      settings: { ...getDefaultSettings('/tmp'), tabAutoGenerateTitle: false }
    })
    expect(projectMissingGeneratedTabTitlesFromAgentStatuses(store.getState())).toEqual([])
  })

  it('uses dispatch labels and keeps an existing generated title', () => {
    const { store, paneKey } = seedStore()
    const dispatchPrompt = `You are working inside Orca, a multi-agent IDE. You are a dispatched worker.
Your task ID is: task-1
=== TASK ===
Implement the long worker instructions`
    store.getState().setAgentStatus(paneKey, {
      state: 'working',
      prompt: dispatchPrompt,
      agentType: 'codex',
      orchestration: { taskId: 'task-1', dispatchId: 'dispatch-1', taskTitle: 'Dispatch label' }
    })
    store.setState({
      settings: { ...getDefaultSettings('/tmp'), tabAutoGenerateTitle: true }
    })
    expect(projectMissingGeneratedTabTitlesFromAgentStatuses(store.getState())[0]?.prompt).toBe(
      'Dispatch label'
    )

    store.setState({
      tabsByWorktree: {
        [WORKTREE_ID]: [
          makeTab({
            id: 'tab-1',
            worktreeId: WORKTREE_ID,
            generatedTitle: 'Existing title'
          })
        ]
      }
    })
    expect(projectMissingGeneratedTabTitlesFromAgentStatuses(store.getState())).toEqual([])
  })
})
