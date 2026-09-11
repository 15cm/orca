import type { AppState } from '../types'
import type { Tab, TabGroup, TabGroupLayoutNode } from '../../../../shared/tab-types'
import { createBrowserUuid } from '@/lib/browser-uuid'
import {
  dedupeTabOrder,
  findGroupForTab,
  findTabAndWorktree,
  pickNextActiveTab,
  pushRecentTabId,
  sanitizeRecentTabIds
} from './tab-group-state'
import { collapseGroupLayout } from './tab-group-layout-tree'
import {
  MOVABLE_TAB_CONTENT_TYPES,
  rehomeTabContentRecords,
  type TabWorkspacePaths
} from './tab-workspace-move-content'

// Design notes, including the cwd rule: docs/reference/tab-workspace-move.md
export type TabWorkspaceMoveState = Pick<
  AppState,
  | 'activeGroupIdByWorktree'
  | 'browserTabsByWorktree'
  | 'groupsByWorktree'
  | 'layoutByWorktree'
  | 'openFiles'
  | 'tabBarOrderByWorktree'
  | 'tabsByWorktree'
  | 'unifiedTabsByWorktree'
  | 'worktreesByRepo'
>

export type TabWorkspaceMove = {
  patch: Partial<AppState>
  tab: Tab
  sourceWorktreeId: string
  targetWorktreeId: string
  targetGroupId: string
  /** Set when the destination workspace roots at a different folder, so the live
   *  process keeps the cwd it was launched in. */
  retainedCwd: string | null
}

export function isMovableTabContentType(contentType: Tab['contentType']): boolean {
  return MOVABLE_TAB_CONTENT_TYPES.includes(contentType)
}

// Why not the cached selector: importing store/selectors from a slice closes an
// import cycle through the store root and leaves createTestStore half-built.
function findWorkspacePath(
  worktreesByRepo: AppState['worktreesByRepo'],
  worktreeId: string
): string | null {
  for (const worktrees of Object.values(worktreesByRepo)) {
    const match = worktrees.find((worktree) => worktree.id === worktreeId)
    if (match) {
      return match.path ?? null
    }
  }
  return null
}

function resolveWorkspacePaths(
  state: Pick<AppState, 'worktreesByRepo'>,
  sourceWorktreeId: string,
  targetWorktreeId: string
): TabWorkspacePaths {
  return {
    source: findWorkspacePath(state.worktreesByRepo, sourceWorktreeId),
    target: findWorkspacePath(state.worktreesByRepo, targetWorktreeId)
  }
}

type DestinationGroup = {
  groupId: string
  groups: TabGroup[]
  layout: TabGroupLayoutNode
}

/** Lands the tab in the destination's focused group, creating a root group when
 *  the workspace has none yet (mirrors ensureWorktreeRootGroup). */
function resolveDestinationGroup(
  state: TabWorkspaceMoveState,
  targetWorktreeId: string
): DestinationGroup {
  const groups = state.groupsByWorktree[targetWorktreeId] ?? []
  const focusedId = state.activeGroupIdByWorktree[targetWorktreeId]
  const focused = groups.find((group) => group.id === focusedId) ?? groups[0]
  if (focused) {
    return {
      groupId: focused.id,
      groups,
      layout: state.layoutByWorktree[targetWorktreeId] ?? { type: 'leaf', groupId: focused.id }
    }
  }
  const groupId = createBrowserUuid()
  return {
    groupId,
    groups: [{ id: groupId, worktreeId: targetWorktreeId, activeTabId: null, tabOrder: [] }],
    layout: { type: 'leaf', groupId }
  }
}

function buildSourceGroups(
  state: TabWorkspaceMoveState,
  sourceWorktreeId: string,
  sourceGroup: TabGroup,
  tabId: string
): { groups: TabGroup[]; emptied: boolean } {
  const dedupedOrder = dedupeTabOrder(sourceGroup.tabOrder)
  const nextOrder = dedupedOrder.filter((id) => id !== tabId)
  const groups = (state.groupsByWorktree[sourceWorktreeId] ?? []).map((group) =>
    group.id === sourceGroup.id
      ? {
          ...group,
          activeTabId:
            group.activeTabId === tabId
              ? pickNextActiveTab(dedupedOrder, sourceGroup.recentTabIds, tabId)
              : group.activeTabId,
          tabOrder: nextOrder,
          recentTabIds: sanitizeRecentTabIds(
            (sourceGroup.recentTabIds ?? []).filter((id) => id !== tabId),
            nextOrder
          )
        }
      : group
  )
  return { groups, emptied: nextOrder.length === 0 }
}

/** Why append without activating: moving a finished agent out of the way must not
 *  yank focus into the destination workspace. An empty destination group has no
 *  active tab to preserve, so it adopts the arrival. */
function buildDestinationGroups(
  destination: DestinationGroup,
  targetWorktreeId: string,
  tabId: string
): TabGroup[] {
  return destination.groups.map((group) => {
    if (group.id !== destination.groupId) {
      return group
    }
    const tabOrder = [...dedupeTabOrder(group.tabOrder).filter((id) => id !== tabId), tabId]
    const adopts = group.activeTabId === null
    const recentTabIds = sanitizeRecentTabIds(group.recentTabIds, tabOrder)
    return {
      ...group,
      worktreeId: targetWorktreeId,
      activeTabId: adopts ? tabId : group.activeTabId,
      tabOrder,
      recentTabIds: adopts ? pushRecentTabId(recentTabIds, tabId) : recentTabIds
    }
  })
}

/**
 * Reassigns one tab from its workspace to another: unified tab, group membership,
 * split layout, and the record backing the tab's content. Returns null when the
 * move is not representable (unknown tab, same workspace, unmovable content type,
 * missing backing record), so callers can leave state untouched.
 */
export function buildTabWorkspaceMove(
  state: TabWorkspaceMoveState,
  tabId: string,
  targetWorktreeId: string
): TabWorkspaceMove | null {
  const found = findTabAndWorktree(state.unifiedTabsByWorktree, tabId)
  if (!found || found.worktreeId === targetWorktreeId) {
    return null
  }
  const { tab, worktreeId: sourceWorktreeId } = found
  if (!isMovableTabContentType(tab.contentType)) {
    return null
  }
  const sourceGroup = findGroupForTab(state.groupsByWorktree, sourceWorktreeId, tab.groupId)
  if (!sourceGroup) {
    return null
  }

  const paths = resolveWorkspacePaths(state, sourceWorktreeId, targetWorktreeId)
  const content = rehomeTabContentRecords(state, tab, targetWorktreeId, paths)
  if (!content) {
    return null
  }

  const destination = resolveDestinationGroup(state, targetWorktreeId)
  const source = buildSourceGroups(state, sourceWorktreeId, sourceGroup, tabId)
  const targetTabs = state.unifiedTabsByWorktree[targetWorktreeId] ?? []
  const movedTab: Tab = {
    ...tab,
    worktreeId: targetWorktreeId,
    groupId: destination.groupId,
    sortOrder: targetTabs.length
  }

  let groupsByWorktree = {
    ...state.groupsByWorktree,
    [sourceWorktreeId]: source.groups,
    [targetWorktreeId]: buildDestinationGroups(destination, targetWorktreeId, tabId)
  }
  let layoutByWorktree = {
    ...state.layoutByWorktree,
    [targetWorktreeId]: destination.layout
  }
  // Why re-point: a destination whose focused group id is stale (or absent) would
  // otherwise keep naming a group that no longer exists once the tab lands.
  const focusedTargetGroupId = destination.groups.some(
    (group) => group.id === state.activeGroupIdByWorktree[targetWorktreeId]
  )
    ? state.activeGroupIdByWorktree[targetWorktreeId]
    : destination.groupId
  let activeGroupIdByWorktree = {
    ...state.activeGroupIdByWorktree,
    [targetWorktreeId]: focusedTargetGroupId
  }

  if (source.emptied) {
    const remainingGroups = source.groups.filter((group) => group.id !== sourceGroup.id)
    groupsByWorktree = { ...groupsByWorktree, [sourceWorktreeId]: remainingGroups }
    const collapsed = collapseGroupLayout(
      layoutByWorktree,
      activeGroupIdByWorktree,
      sourceWorktreeId,
      sourceGroup.id,
      remainingGroups[0]?.id ?? null
    )
    layoutByWorktree = collapsed.layoutByWorktree
    activeGroupIdByWorktree = collapsed.activeGroupIdByWorktree
  }

  return {
    patch: {
      ...content.patch,
      unifiedTabsByWorktree: {
        ...state.unifiedTabsByWorktree,
        [sourceWorktreeId]: (state.unifiedTabsByWorktree[sourceWorktreeId] ?? []).filter(
          (candidate) => candidate.id !== tabId
        ),
        [targetWorktreeId]: [...targetTabs.filter((candidate) => candidate.id !== tabId), movedTab]
      },
      groupsByWorktree,
      layoutByWorktree,
      activeGroupIdByWorktree
    },
    tab: movedTab,
    sourceWorktreeId,
    targetWorktreeId,
    targetGroupId: destination.groupId,
    retainedCwd: content.retainedCwd
  }
}
