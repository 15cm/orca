import { describe, expect, it } from 'vitest'
import {
  resolveScopeRepoIds,
  resolveScopesServedByOtherWindows,
  resolveScopeWorktreeIds
} from './window-scoped-session-keys'
import { getDefaultWorkspaceSession } from '../../shared/constants'
import type { WorkspaceSessionState } from '../../shared/workspace-session-state-types'

const SCOPE = { type: 'project-group' as const, projectGroupId: 'perc' }

const REPOS = [
  { id: 'repo-a', projectGroupId: 'perc' },
  { id: 'repo-nested', projectGroupId: 'perc-sub' },
  { id: 'repo-other', projectGroupId: 'otro' },
  { id: 'repo-loose', projectGroupId: null }
]

const GROUPS = [
  { id: 'perc', parentGroupId: null },
  { id: 'perc-sub', parentGroupId: 'perc' },
  { id: 'otro', parentGroupId: null }
]

function session(overrides: Partial<WorkspaceSessionState>): WorkspaceSessionState {
  return { ...getDefaultWorkspaceSession(), ...overrides }
}

describe('resolveScopeRepoIds', () => {
  it('includes the repos of nested subgroups', () => {
    expect(resolveScopeRepoIds(SCOPE, REPOS, GROUPS)).toEqual(new Set(['repo-a', 'repo-nested']))
  })

  it('excludes repos of other groups and ungrouped repos', () => {
    const repoIds = resolveScopeRepoIds(SCOPE, REPOS, GROUPS)
    expect(repoIds.has('repo-other')).toBe(false)
    expect(repoIds.has('repo-loose')).toBe(false)
  })

  it('is empty for a group with no repos, so the window owns nothing', () => {
    expect(resolveScopeRepoIds({ ...SCOPE, projectGroupId: 'vacio' }, REPOS, GROUPS).size).toBe(0)
  })
})

describe('resolveScopeWorktreeIds', () => {
  it('selects the session keys whose worktree belongs to the scope repos', () => {
    const current = session({
      tabsByWorktree: {
        'repo-a::/wt/main': [],
        'repo-nested::/wt/feature': [],
        'repo-other::/wt/main': []
      }
    })

    expect(resolveScopeWorktreeIds(current, new Set(['repo-a', 'repo-nested']))).toEqual(
      new Set(['repo-a::/wt/main', 'repo-nested::/wt/feature'])
    )
  })

  it('owns nothing when the scope has no repos', () => {
    const current = session({ tabsByWorktree: { 'repo-a::/wt/main': [] } })
    expect(resolveScopeWorktreeIds(current, new Set()).size).toBe(0)
  })

  it('picks up worktrees that appear only in the shutdown list', () => {
    const current = session({ activeWorktreeIdsOnShutdown: ['repo-a::/wt/main'] })
    expect(resolveScopeWorktreeIds(current, new Set(['repo-a']))).toEqual(
      new Set(['repo-a::/wt/main'])
    )
  })
})

describe('resolveScopesServedByOtherWindows', () => {
  const scopeByWebContents = new Map([
    [1, null],
    [2, { type: 'project-group' as const, projectGroupId: 'perc' }],
    [3, { type: 'project-group' as const, projectGroupId: 'otro' }]
  ])
  const windows = [1, 2, 3].map((id) => ({ webContents: { id } }))
  const resolve = (id: number) => scopeByWebContents.get(id) ?? null

  it('lists the scopes other windows serve, so the free window can exclude them', () => {
    expect(resolveScopesServedByOtherWindows(1, windows, resolve)).toEqual([
      { type: 'project-group', projectGroupId: 'perc' },
      { type: 'project-group', projectGroupId: 'otro' }
    ])
  })

  it('never counts the asking window itself', () => {
    expect(resolveScopesServedByOtherWindows(2, windows, resolve)).toEqual([
      { type: 'project-group', projectGroupId: 'otro' }
    ])
  })

  it('is empty when no other window is scoped', () => {
    expect(resolveScopesServedByOtherWindows(1, [{ webContents: { id: 1 } }], resolve)).toEqual([])
  })
})
