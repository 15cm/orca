import type { AppState } from '../types'
import type { Tab } from '../../../../shared/tab-types'
import type { TerminalTab } from '../../../../shared/terminal-tab-types'
import { relativePathInsideRoot } from '../../../../shared/cross-platform-path'

/** Content types whose backing record can be rehomed to another workspace.
 *  Diff, conflict-review and check-details tabs are excluded on purpose: their
 *  content is derived from the source workspace's git state, so a moved tab
 *  would keep rendering another workspace's changes under the new card. */
export const MOVABLE_TAB_CONTENT_TYPES: readonly Tab['contentType'][] = [
  'terminal',
  'editor',
  'browser'
]

export type TabWorkspacePaths = { source: string | null; target: string | null }

export type TabContentRehome = {
  patch: Partial<AppState>
  /** Working directory the live process keeps because it cannot be re-rooted. */
  retainedCwd: string | null
}

function moveKeyedRecord<T extends { id: string }>(
  byWorktree: Record<string, T[]>,
  sourceWorktreeId: string,
  targetWorktreeId: string,
  rehomed: T
): Record<string, T[]> {
  return {
    ...byWorktree,
    [sourceWorktreeId]: (byWorktree[sourceWorktreeId] ?? []).filter(
      (entry) => entry.id !== rehomed.id
    ),
    [targetWorktreeId]: [
      ...(byWorktree[targetWorktreeId] ?? []).filter((entry) => entry.id !== rehomed.id),
      rehomed
    ]
  }
}

function moveTabBarOrder(
  tabBarOrderByWorktree: AppState['tabBarOrderByWorktree'],
  sourceWorktreeId: string,
  targetWorktreeId: string,
  entityId: string
): AppState['tabBarOrderByWorktree'] {
  const sourceOrder = tabBarOrderByWorktree[sourceWorktreeId]
  if (!sourceOrder?.includes(entityId)) {
    return tabBarOrderByWorktree
  }
  return {
    ...tabBarOrderByWorktree,
    [sourceWorktreeId]: sourceOrder.filter((id) => id !== entityId),
    [targetWorktreeId]: [
      ...(tabBarOrderByWorktree[targetWorktreeId] ?? []).filter((id) => id !== entityId),
      entityId
    ]
  }
}

/** Why: the shell's cwd cannot be re-rooted while it runs, so a cross-folder move
 *  pins the original directory on the tab. Restarts then respawn where the work
 *  actually happened instead of silently jumping to the destination folder. */
function resolveRetainedCwd(tab: TerminalTab, paths: TabWorkspacePaths): string | null {
  if (!paths.source || !paths.target || paths.source === paths.target) {
    return null
  }
  return tab.startupCwd ?? paths.source
}

function rehomeTerminalRow(
  state: Pick<AppState, 'tabsByWorktree'>,
  tab: Tab,
  targetWorktreeId: string,
  paths: TabWorkspacePaths
): TabContentRehome | null {
  const row = (state.tabsByWorktree[tab.worktreeId] ?? []).find(
    (candidate) => candidate.id === tab.entityId
  )
  if (!row) {
    return null
  }
  const retainedCwd = resolveRetainedCwd(row, paths)
  return {
    patch: {
      tabsByWorktree: moveKeyedRecord(state.tabsByWorktree, tab.worktreeId, targetWorktreeId, {
        ...row,
        worktreeId: targetWorktreeId,
        ...(retainedCwd ? { startupCwd: retainedCwd } : {})
      })
    },
    retainedCwd
  }
}

function rehomeBrowserWorkspace(
  state: Pick<AppState, 'browserTabsByWorktree'>,
  tab: Tab,
  targetWorktreeId: string
): TabContentRehome | null {
  const workspace = (state.browserTabsByWorktree[tab.worktreeId] ?? []).find(
    (candidate) => candidate.id === tab.entityId
  )
  if (!workspace) {
    return null
  }
  return {
    patch: {
      browserTabsByWorktree: moveKeyedRecord(
        state.browserTabsByWorktree,
        tab.worktreeId,
        targetWorktreeId,
        { ...workspace, worktreeId: targetWorktreeId }
      )
    },
    retainedCwd: null
  }
}

function rehomeOpenFile(
  state: Pick<AppState, 'openFiles'>,
  tab: Tab,
  targetWorktreeId: string,
  paths: TabWorkspacePaths
): TabContentRehome | null {
  const file = state.openFiles.find((candidate) => candidate.id === tab.entityId)
  if (!file) {
    return null
  }
  // Why: relativePath drives the tab breadcrumb; recompute it against the new
  // root and fall back to the absolute path when the file lives outside it.
  const relative = paths.target ? relativePathInsideRoot(paths.target, file.filePath) : null
  return {
    patch: {
      openFiles: state.openFiles.map((candidate) =>
        candidate.id === tab.entityId
          ? {
              ...candidate,
              worktreeId: targetWorktreeId,
              relativePath: relative ? relative : candidate.filePath
            }
          : candidate
      )
    },
    retainedCwd: null
  }
}

/** Rehomes the record backing a unified tab (terminal row, open file or browser
 *  workspace) plus the legacy tab-bar order. Returns null when that record is
 *  missing, which must abort the whole move rather than strand half of it. */
export function rehomeTabContentRecords(
  state: Pick<
    AppState,
    'browserTabsByWorktree' | 'openFiles' | 'tabBarOrderByWorktree' | 'tabsByWorktree'
  >,
  tab: Tab,
  targetWorktreeId: string,
  paths: TabWorkspacePaths
): TabContentRehome | null {
  const rehomed =
    tab.contentType === 'terminal'
      ? rehomeTerminalRow(state, tab, targetWorktreeId, paths)
      : tab.contentType === 'browser'
        ? rehomeBrowserWorkspace(state, tab, targetWorktreeId)
        : rehomeOpenFile(state, tab, targetWorktreeId, paths)
  if (!rehomed) {
    return null
  }
  return {
    ...rehomed,
    patch: {
      ...rehomed.patch,
      tabBarOrderByWorktree: moveTabBarOrder(
        state.tabBarOrderByWorktree,
        tab.worktreeId,
        targetWorktreeId,
        tab.entityId
      )
    }
  }
}
