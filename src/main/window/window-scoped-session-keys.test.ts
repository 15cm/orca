import { describe, expect, it } from 'vitest'
import {
  resolveScopeSessionKeys,
  resolveScopesServedByOtherWindows
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

const FOLDER_WORKSPACES = [
  { id: 'terminals', projectGroupId: 'perc' },
  { id: 'nested-notes', projectGroupId: 'perc-sub' },
  { id: 'ajeno', projectGroupId: 'otro' }
]

const SOURCES = {
  getRepo: (repoId: string) => REPOS.find((repo) => repo.id === repoId),
  getFolderWorkspaces: () => FOLDER_WORKSPACES,
  getProjectGroups: () => GROUPS
}

describe('resolveScopeSessionKeys', () => {
  it('selects the keys of the scope group and its subgroups', () => {
    const current = session({
      tabsByWorktree: {
        'repo-a::/wt/main': [],
        'repo-nested::/wt/feature': [],
        'repo-other::/wt/main': []
      }
    })

    expect(resolveScopeSessionKeys(SCOPE, current, SOURCES)).toEqual(
      new Set(['repo-a::/wt/main', 'repo-nested::/wt/feature'])
    )
  })

  // Why: a folder workspace carries its own group, so reading a repo id out of the key drops it —
  // and with it the project's own terminals, which is what left a project window opening empty.
  it('selects folder workspaces of the scope, which carry their group directly', () => {
    const current = session({
      tabsByWorktree: {
        'folder:terminals': [],
        'folder:nested-notes': [],
        'folder:ajeno': []
      }
    })

    expect(resolveScopeSessionKeys(SCOPE, current, SOURCES)).toEqual(
      new Set(['folder:terminals', 'folder:nested-notes'])
    )
  })

  it('excludes other groups, ungrouped repos and unknown ids', () => {
    const current = session({
      tabsByWorktree: {
        'repo-other::/wt/main': [],
        'repo-loose::/wt/main': [],
        'folder:desconocido': [],
        'sin-separador': []
      }
    })
    expect(resolveScopeSessionKeys(SCOPE, current, SOURCES).size).toBe(0)
  })

  it('owns nothing when the group has no workspaces', () => {
    const current = session({ tabsByWorktree: { 'repo-a::/wt/main': [] } })
    expect(
      resolveScopeSessionKeys({ ...SCOPE, projectGroupId: 'vacio' }, current, SOURCES).size
    ).toBe(0)
  })

  it('picks up worktrees that appear only in the shutdown list', () => {
    const current = session({ activeWorktreeIdsOnShutdown: ['repo-a::/wt/main'] })
    expect(resolveScopeSessionKeys(SCOPE, current, SOURCES)).toEqual(new Set(['repo-a::/wt/main']))
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
