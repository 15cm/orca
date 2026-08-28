import { describe, expect, it } from 'vitest'
import { worktreeWorkspaceKey } from '../../../shared/workspace-scope'
import type { WorkspaceSessionState } from '../../../shared/workspace-session-state-types'
import {
  EMPTY_WINDOW_SESSION_FIELD_POLICY,
  emptyWindowWorkspaceSession
} from './empty-window-workspace-session'

function fullyPopulatedSession(): WorkspaceSessionState {
  return {
    activeRepoId: 'repo-1',
    activeWorkspaceKey: worktreeWorkspaceKey('repo-1::/wt'),
    activeWorkspaceExecutionHostId: 'local',
    activeWorktreeId: 'repo-1::/wt',
    activeTabId: 'tab-1',
    tabsByWorktree: { 'repo-1::/wt': [] },
    terminalLayoutsByTabId: { 'tab-1': { root: null, activeLeafId: null, expandedLeafId: null } },
    activeWorktreeIdsOnShutdown: ['repo-1::/wt'],
    openFilesByWorktree: { 'repo-1::/wt': [] },
    activeFileIdByWorktree: { 'repo-1::/wt': 'file.ts' },
    markdownFrontmatterVisible: { 'file.md': true },
    browserTabsByWorktree: { 'repo-1::/wt': [] },
    browserPagesByWorkspace: { 'browser-1': [] },
    clientHostedBrowserPagesByWorktree: {
      'repo-1::/wt': [
        {
          v: 1,
          browserPageId: 'page-1',
          workspaceId: 'browser-1',
          browserProfileId: 'profile-1',
          url: 'https://example.test',
          title: 'Example',
          pairedDeviceId: 'device-1',
          savedAt: 1
        }
      ]
    },
    activeBrowserTabIdByWorktree: { 'repo-1::/wt': 'browser-1' },
    activeTabTypeByWorktree: { 'repo-1::/wt': 'terminal' },
    activeTabIdByWorktree: { 'repo-1::/wt': 'tab-1' },
    unifiedTabs: { 'repo-1::/wt': [] },
    tabGroups: { 'repo-1::/wt': [] },
    tabGroupLayouts: { 'repo-1::/wt': { type: 'leaf', groupId: 'group-1' } },
    activeGroupIdByWorktree: { 'repo-1::/wt': 'group-1' },
    activeConnectionIdsAtShutdown: ['ssh-1'],
    remoteSessionIdsByTabId: { 'tab-1': 'relay-1' },
    lastVisitedAtByWorktreeId: { 'repo-1::/wt': 42 },
    defaultTerminalTabsAppliedByWorktreeId: { 'repo-1::/wt': true },
    sleepingAgentSessionsByPaneKey: {
      'tab-1:leaf-1': {
        paneKey: 'tab-1:leaf-1',
        worktreeId: 'repo-1::/wt',
        agent: 'claude',
        providerSession: { key: 'session_id', id: 'claude-1' },
        prompt: 'Fix tests',
        state: 'working',
        capturedAt: 1,
        updatedAt: 2
      }
    },
    terminalPtyIncarnationsByPaneKey: { 'tab-1:leaf-1': 'inc-1' },
    terminalTopologyRevisionByRepoId: { 'repo-1': 7 },
    terminalSurfaceTombstonesByPaneKey: {
      'tab-1:leaf-1': {
        worktreeId: 'repo-1::/wt',
        parentTabId: 'tab-1',
        leafId: 'leaf-1',
        ptyId: 'pty-1',
        incarnationId: 'inc-1',
        retiredAt: 3
      }
    },
    browserUrlHistory: [
      {
        url: 'https://example.test',
        normalizedUrl: 'example.test',
        title: 'Example',
        lastVisitedAt: 1,
        visitCount: 1
      }
    ]
  }
}

function isBlank(value: unknown): boolean {
  if (value === undefined || value === null) {
    return true
  }
  if (Array.isArray(value)) {
    return value.length === 0
  }
  return typeof value === 'object' && Object.keys(value as object).length === 0
}

describe('emptyWindowWorkspaceSession', () => {
  const session = fullyPopulatedSession()
  const projected = emptyWindowWorkspaceSession(session)
  const fields = Object.keys(EMPTY_WINDOW_SESSION_FIELD_POLICY) as (keyof WorkspaceSessionState)[]

  // Why table-driven: the policy is the contract a new session field must join; a projection
  // that quietly forgets to honour it is exactly the leak the table exists to prevent.
  it.each(fields.filter((field) => EMPTY_WINDOW_SESSION_FIELD_POLICY[field] === 'drop'))(
    'drops %s',
    (field) => {
      expect(isBlank(session[field])).toBe(false)
      expect(isBlank(projected[field])).toBe(true)
    }
  )

  it.each(fields.filter((field) => EMPTY_WINDOW_SESSION_FIELD_POLICY[field] === 'carry'))(
    'carries %s over',
    (field) => {
      expect(projected[field]).toEqual(session[field])
    }
  )

  it('tolerates a session written by a build that had none of the carried fields', () => {
    const projectedSparse = emptyWindowWorkspaceSession({
      activeRepoId: null,
      activeWorktreeId: null,
      activeTabId: null,
      tabsByWorktree: {},
      terminalLayoutsByTabId: {}
    })
    expect(projectedSparse.browserUrlHistory).toBeUndefined()
    expect(projectedSparse.lastVisitedAtByWorktreeId).toBeUndefined()
  })
})
