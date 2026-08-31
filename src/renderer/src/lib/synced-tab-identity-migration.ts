import type { StoreApi } from 'zustand'
import type { AppState } from '../store/types'
import { makeSyncedTabIdentity } from '../../../shared/synced-tab-identity'
import { migrateBrowserState } from './synced-browser-identity-migration'
import type {
  AgentStatusEntry,
  AgentStatusOrchestrationContext
} from '../../../shared/agent-status-types'

type IdentityState = AppState & Record<string, unknown>
type PaneIdentityRecord = { paneKey?: string; tabId?: string; [key: string]: unknown }

export type { SyncedIdentityMigrationOptions } from './synced-browser-identity-migration'
import type { SyncedIdentityMigrationOptions } from './synced-browser-identity-migration'

function entityIdentity(
  tuple: SyncedIdentityMigrationOptions,
  entityId = tuple.catalogEntityId
): string | null {
  return entityId ? makeSyncedTabIdentity({ ...tuple, catalogTabId: entityId }, 'entity') : null
}

function replaceKey<T>(map: Record<string, T>, oldId: string, nextId: string): Record<string, T> {
  if (!(oldId in map) || oldId === nextId) {
    return map
  }
  const result = { ...map }
  if (!(nextId in result)) {
    result[nextId] = result[oldId]!
  } else {
    const source = result[oldId]
    const target = result[nextId]
    result[nextId] =
      Array.isArray(source) && Array.isArray(target)
        ? ([...new Set([...target, ...source])] as T)
        : typeof source === 'object' && source && typeof target === 'object' && target
          ? ({ ...target, ...source } as T)
          : source
  }
  delete result[oldId]
  return result
}
function replacePanePrefix<T>(
  map: Record<string, T>,
  source: string,
  destination: string
): Record<string, T> {
  if (source === destination) {
    return map
  }
  const result = { ...map }
  for (const [key, value] of Object.entries(map)) {
    if (key === source || key.startsWith(`${source}:`)) {
      result[`${destination}${key.slice(source.length)}`] = value
      delete result[key]
    }
  }
  return result
}
function rewritePaneKey(value: string, source: string, destination: string): string {
  return value === source || value.startsWith(`${source}:`)
    ? `${destination}${value.slice(source.length)}`
    : value
}

function rewriteOrchestration(
  value: AgentStatusOrchestrationContext | undefined,
  source: string,
  destination: string
): AgentStatusOrchestrationContext | undefined {
  return value
    ? {
        ...value,
        ...(value.parentPaneKey
          ? { parentPaneKey: rewritePaneKey(value.parentPaneKey, source, destination) }
          : {})
      }
    : value
}
function rewriteAgentStatus(
  entry: AgentStatusEntry,
  source: string,
  destination: string
): AgentStatusEntry {
  return {
    ...entry,
    ...(entry.paneKey ? { paneKey: rewritePaneKey(entry.paneKey, source, destination) } : {}),
    ...(entry.tabId === source ? { tabId: destination } : {}),
    orchestration: rewriteOrchestration(entry.orchestration, source, destination)
  }
}
function rewritePaneIdentity(
  value: PaneIdentityRecord,
  source: string,
  destination: string
): PaneIdentityRecord {
  return {
    ...value,
    ...(value.paneKey ? { paneKey: rewritePaneKey(value.paneKey, source, destination) } : {}),
    ...(value.tabId === source ? { tabId: destination } : {})
  }
}

export function planSyncedTabIdentityMigration(
  current: AppState,
  tuple: SyncedIdentityMigrationOptions,
  oldId: string
): Partial<IdentityState> | null {
  const sourceTabId = oldId
  const nextId = makeSyncedTabIdentity(tuple, 'tab')
  if (nextId === oldId) {
    return {}
  }
  const requestedExecutionHostId = tuple.executionHostId ?? 'local'
  const sourceTabs = (current.unifiedTabsByWorktree[tuple.workspaceKey] ?? []).filter(
    (tab) =>
      tab.id === oldId &&
      (tab.catalogTabId ?? tab.id) === tuple.catalogTabId &&
      (tab.executionHostId ?? 'local') === requestedExecutionHostId
  )
  const sourceTab = sourceTabs.length === 1 ? sourceTabs[0] : undefined
  if (
    !sourceTab ||
    (tuple.executionHostId && tuple.executionHostId !== 'local' && !sourceTab.executionHostId)
  ) {
    tuple.onCollision?.(sourceTabId)
    return null
  }
  const sourceEntityId = sourceTab.entityId
  const ambiguousRawIdentity = (current.unifiedTabsByWorktree[tuple.workspaceKey] ?? []).find(
    (tab) =>
      tab !== sourceTab &&
      ((tab.id === sourceTabId && tab.id !== nextId) ||
        (sourceEntityId && tab.entityId === sourceEntityId)) &&
      (tab.executionHostId ?? 'local') !== requestedExecutionHostId
  )
  if (ambiguousRawIdentity) {
    tuple.onCollision?.(ambiguousRawIdentity.id === sourceTabId ? sourceTabId : sourceEntityId!)
    return null
  }
  const isTerminalSource = sourceTab.contentType === 'terminal'
  const isBrowserSource = sourceTab.contentType === 'browser'
  const canonicalEntityId = tuple.catalogEntityId ?? sourceTab.catalogEntityId
  if (!canonicalEntityId) {
    tuple.onCollision?.(sourceTabId)
    return null
  }
  const nextEntityId = entityIdentity(tuple, canonicalEntityId)
  const terminalBackings = isTerminalSource
    ? (current.tabsByWorktree[tuple.workspaceKey] ?? []).filter((tab) => tab.id === sourceEntityId)
    : []
  if (isTerminalSource && terminalBackings.length !== 1) {
    tuple.onCollision?.(sourceEntityId)
    return null
  }
  if (
    isTerminalSource &&
    (current.tabsByWorktree[tuple.workspaceKey] ?? []).some(
      (tab) => tab.id === nextEntityId && tab.id !== sourceEntityId
    )
  ) {
    tuple.onCollision?.(nextEntityId!)
    return null
  }
  const rejectListConvergence = (
    values: string[] | undefined,
    source: string,
    destination: string
  ) => source !== destination && values?.includes(source) && values.includes(destination)
  if (
    (current.groupsByWorktree[tuple.workspaceKey] ?? []).some(
      (group) =>
        rejectListConvergence(group.tabOrder, sourceTabId, nextId) ||
        rejectListConvergence(group.recentTabIds, sourceTabId, nextId)
    )
  ) {
    tuple.onCollision?.(nextId)
    return null
  }
  if (
    isTerminalSource &&
    (rejectListConvergence(
      current.tabBarOrderByWorktree[tuple.workspaceKey],
      sourceEntityId,
      nextEntityId!
    ) ||
      rejectListConvergence(
        current.pendingReconnectTabByWorktree[tuple.workspaceKey],
        sourceEntityId,
        nextEntityId!
      ))
  ) {
    tuple.onCollision?.(nextEntityId!)
    return null
  }
  const existing = current.unifiedTabsByWorktree[tuple.workspaceKey]?.find(
    (tab) => tab.id === nextId
  )
  if (existing) {
    tuple.onCollision?.(nextId)
    return null
  }
  const entityRekeyed = [
    'ptyIdsByTabId',
    'terminalLayoutsByTabId',
    'runtimePaneTitlesByTabId',
    'unreadTerminalTabs',
    'unreadTerminalPanes',
    'directSshPaneRetryByTabId',
    'directSshLivePtyBindingByTabId',
    'directSshPaneRetryHistoryByTabId',
    'expandedPaneByTabId',
    'canExpandPaneByTabId',
    'automaticAgentResumeClaimsByTabId',
    'nativeChatLaunchPromptByTabId',
    'nativeChatLaunchDraftByTabId',
    'pendingStartupByTabId',
    'pendingInitialCwdByTabId',
    'pendingSetupSplitByTabId',
    'pendingIssueCommandSplitByTabId',
    'pendingReconnectPtyIdByTabId',
    'lastKnownRelayPtyIdByTabId',
    'deferredSshSessionIdsByTabId',
    'recentlyClosedAgentStatusTabIds',
    'migrationUnsupportedByPtyId'
  ]
  const rejectKeyCollision = (
    map: Record<string, unknown> | undefined,
    source: string,
    destination: string
  ) => map && source !== destination && source in map && destination in map
  for (const key of isTerminalSource ? entityRekeyed : []) {
    if (
      rejectKeyCollision(
        current[key] as Record<string, unknown> | undefined,
        sourceEntityId,
        nextEntityId!
      )
    ) {
      tuple.onCollision?.(nextEntityId!)
      return null
    }
  }
  for (const key of isTerminalSource
    ? [
        'unreadTerminalPanes',
        'unreadAgentCompletionPanes',
        'acknowledgedAgentsByPaneKey',
        'paneForegroundAgentByPaneKey',
        'retentionSuppressedPaneKeys',
        'recentlyRetiredAgentStatusPaneKeys',
        'cacheTimerByKey',
        'lastTerminalInputAtByPaneKey',
        'agentStatusByPaneKey',
        'runtimeAgentOrchestrationByPaneKey',
        'retainedAgentsByPaneKey',
        'agentLaunchConfigByPaneKey',
        'sleepingAgentSessionsByPaneKey'
      ]
    : []) {
    const map = current[key] as Record<string, unknown> | undefined
    if (
      sourceEntityId !== nextEntityId &&
      map &&
      Object.keys(map).some(
        (keyId) =>
          (keyId === sourceEntityId || keyId.startsWith(`${sourceEntityId}:`)) &&
          `${nextEntityId}${keyId.slice(sourceEntityId.length)}` in map
      )
    ) {
      tuple.onCollision?.(nextEntityId!)
      return null
    }
  }
  for (const key of [
    'editorDrafts',
    'markdownViewMode',
    'editorViewMode',
    'markdownFrontmatterVisible',
    'markdownTableOfContentsVisible'
  ]) {
    const map = current[key] as Record<string, unknown> | undefined
    if (
      rejectKeyCollision(map, sourceEntityId, nextEntityId!) ||
      rejectKeyCollision(map, sourceTabId, nextEntityId!) ||
      rejectKeyCollision(map, sourceTabId, nextId) ||
      (map && sourceEntityId !== sourceTabId && sourceEntityId in map && sourceTabId in map)
    ) {
      tuple.onCollision?.(nextEntityId!)
      return null
    }
  }
  const mapState = (isTerminalSource ? entityRekeyed : []).reduce<Record<string, unknown>>(
    (result, key) => {
      const map = current[key] as Record<string, unknown> | undefined
      if (map) {
        result[key] = replaceKey(map, sourceEntityId, nextEntityId!)
      }
      return result
    },
    {}
  )
  for (const key of isTerminalSource
    ? [
        'unreadTerminalPanes',
        'unreadAgentCompletionPanes',
        'acknowledgedAgentsByPaneKey',
        'paneForegroundAgentByPaneKey',
        'retentionSuppressedPaneKeys',
        'recentlyRetiredAgentStatusPaneKeys',
        'cacheTimerByKey',
        'lastTerminalInputAtByPaneKey'
      ]
    : []) {
    const map = current[key] as Record<string, unknown> | undefined
    if (map) {
      mapState[key] = replacePanePrefix(map, sourceEntityId, nextEntityId!)
    }
  }
  const statusMap = current.agentStatusByPaneKey
  if (isTerminalSource) {
    mapState.agentStatusByPaneKey = Object.fromEntries(
      Object.entries(statusMap).map(([key, value]) =>
        key === sourceEntityId || key.startsWith(`${sourceEntityId}:`)
          ? [
              `${nextEntityId}${key.slice(sourceEntityId.length)}`,
              rewriteAgentStatus(value, sourceEntityId, nextEntityId!)
            ]
          : [key, value]
      )
    )
  }
  const orchestrationMap = current.runtimeAgentOrchestrationByPaneKey
  if (isTerminalSource) {
    mapState.runtimeAgentOrchestrationByPaneKey = Object.fromEntries(
      Object.entries(orchestrationMap).map(([key, value]) =>
        key === sourceEntityId || key.startsWith(`${sourceEntityId}:`)
          ? [
              `${nextEntityId}${key.slice(sourceEntityId.length)}`,
              rewriteOrchestration(value, sourceEntityId, nextEntityId!)
            ]
          : [key, value]
      )
    )
  }
  const retainedMap = current.retainedAgentsByPaneKey
  if (isTerminalSource) {
    mapState.retainedAgentsByPaneKey = Object.fromEntries(
      Object.entries(retainedMap).map(([key, retained]) =>
        key === sourceEntityId || key.startsWith(`${sourceEntityId}:`)
          ? [
              `${nextEntityId}${key.slice(sourceEntityId.length)}`,
              {
                ...retained,
                entry: rewriteAgentStatus(retained.entry, sourceEntityId, nextEntityId!),
                tab:
                  retained.tab.id === sourceEntityId
                    ? { ...retained.tab, id: nextEntityId }
                    : retained.tab
              }
            ]
          : [key, retained]
      )
    )
  }
  const launchMap = current.agentLaunchConfigByPaneKey
  if (isTerminalSource) {
    mapState.agentLaunchConfigByPaneKey = Object.fromEntries(
      Object.entries(launchMap).map(([key, config]) =>
        key === sourceEntityId || key.startsWith(`${sourceEntityId}:`)
          ? [
              `${nextEntityId}${key.slice(sourceEntityId.length)}`,
              {
                ...config,
                identity: {
                  ...config.identity,
                  ...(config.identity.tabId === sourceEntityId ? { tabId: nextEntityId } : {})
                }
              }
            ]
          : [key, config]
      )
    )
  }
  for (const key of isTerminalSource
    ? [
        'sleepingAgentSessionsByPaneKey',
        'nativeChatLaunchPromptByTabId',
        'nativeChatLaunchDraftByTabId',
        'migrationUnsupportedByPtyId'
      ]
    : []) {
    const map = current[key] as Record<string, unknown> | undefined
    if (!map) {
      continue
    }
    const nextMap = { ...map }
    for (const [keyId, value] of Object.entries(map)) {
      const matches =
        key === 'migrationUnsupportedByPtyId'
          ? true
          : keyId === sourceEntityId || keyId.startsWith(`${sourceEntityId}:`)
      if (matches) {
        const destinationKey =
          key === 'migrationUnsupportedByPtyId'
            ? keyId
            : `${nextEntityId}${keyId.slice(sourceEntityId.length)}`
        nextMap[destinationKey] = rewritePaneIdentity(
          value as PaneIdentityRecord,
          sourceEntityId,
          nextEntityId!
        )
        if (destinationKey !== keyId) {
          delete nextMap[keyId]
        }
      }
    }
    mapState[key] = nextMap
  }
  for (const key of [
    'editorDrafts',
    'markdownViewMode',
    'editorViewMode',
    'markdownFrontmatterVisible',
    'markdownTableOfContentsVisible'
  ]) {
    const map = current[key] as Record<string, unknown> | undefined
    if (map) {
      const entityMap = replaceKey(map, sourceEntityId, nextEntityId ?? nextId)
      mapState[key] =
        sourceEntityId === sourceTabId
          ? entityMap
          : replaceKey(entityMap, sourceTabId, nextEntityId ?? nextId)
    }
  }
  if (isTerminalSource) {
    mapState.activeTabIdByWorktree = {
      ...current.activeTabIdByWorktree,
      [tuple.workspaceKey]:
        current.activeTabIdByWorktree[tuple.workspaceKey] === sourceEntityId
          ? nextEntityId
          : current.activeTabIdByWorktree[tuple.workspaceKey]
    }
    mapState.tabBarOrderByWorktree = {
      ...current.tabBarOrderByWorktree,
      [tuple.workspaceKey]: current.tabBarOrderByWorktree[tuple.workspaceKey]?.map((id) =>
        id === sourceEntityId ? nextEntityId! : id
      )
    }
  }
  const activeFileIdByWorktree = { ...current.activeFileIdByWorktree }
  if (activeFileIdByWorktree[tuple.workspaceKey] === sourceEntityId) {
    activeFileIdByWorktree[tuple.workspaceKey] = nextEntityId ?? nextId
  }
  const terminalTabs = Object.fromEntries(
    Object.entries(current.tabsByWorktree).map(([worktree, tabs]) => [
      worktree,
      worktree === tuple.workspaceKey
        ? isTerminalSource
          ? tabs
              .filter((tab) => sourceEntityId === nextEntityId || tab.id !== nextEntityId)
              .map((tab) =>
                tab === terminalBackings[0]
                  ? {
                      ...tab,
                      id: nextEntityId!,
                      catalogTabId: tuple.catalogTabId,
                      catalogEntityId: canonicalEntityId
                    }
                  : tab
              )
          : tabs
        : tabs
    ])
  )
  const reconnectTabs = {
    ...current.pendingReconnectTabByWorktree,
    [tuple.workspaceKey]: current.pendingReconnectTabByWorktree[tuple.workspaceKey]?.map((id) =>
      id === sourceEntityId ? nextEntityId! : id
    )
  }
  const matchingOpenFiles = current.openFiles.filter(
    (file) =>
      file.id === sourceEntityId &&
      file.worktreeId === tuple.workspaceKey &&
      (file.catalogEntityId === undefined || file.catalogEntityId === canonicalEntityId)
  )
  if (
    matchingOpenFiles.length > 1 ||
    current.openFiles.some(
      (file) =>
        file.worktreeId === tuple.workspaceKey &&
        file !== matchingOpenFiles[0] &&
        (file.id === nextEntityId || file.id === nextId)
    )
  ) {
    tuple.onCollision?.(nextEntityId!)
    return null
  }
  const sourceOpenFile = matchingOpenFiles.length === 1 ? matchingOpenFiles[0] : undefined
  const browserState = isBrowserSource
    ? migrateBrowserState(
        current,
        tuple,
        oldId,
        nextId,
        sourceEntityId,
        canonicalEntityId,
        true,
        nextEntityId!
      )
    : {}
  if (!browserState) {
    return null
  }
  const next: Partial<IdentityState> = {
    ...mapState,
    unifiedTabsByWorktree: Object.fromEntries(
      Object.entries(current.unifiedTabsByWorktree).map(([worktree, tabs]) => [
        worktree,
        worktree === tuple.workspaceKey
          ? tabs
              .filter((tab) => tab.id !== nextId)
              .map((tab) =>
                tab === sourceTab
                  ? {
                      ...tab,
                      id: nextId,
                      catalogTabId: tuple.catalogTabId,
                      catalogEntityId: canonicalEntityId,
                      ...(nextEntityId ? { entityId: nextEntityId } : {})
                    }
                  : tab
              )
          : tabs
      ])
    ),
    groupsByWorktree: Object.fromEntries(
      Object.entries(current.groupsByWorktree).map(([worktree, groups]) => [
        worktree,
        worktree === tuple.workspaceKey
          ? groups.map((group) => ({
              ...group,
              activeTabId: group.activeTabId === oldId ? nextId : group.activeTabId,
              tabOrder: [...new Set(group.tabOrder.map((id) => (id === oldId ? nextId : id)))],
              recentTabIds: group.recentTabIds
                ? [...new Set(group.recentTabIds.map((id) => (id === oldId ? nextId : id)))]
                : group.recentTabIds
            }))
          : groups
      ])
    ),
    ...browserState,
    activeFileId:
      current.activeFileId === sourceEntityId && sourceOpenFile
        ? (nextEntityId ?? nextId)
        : current.activeFileId,
    activeFileIdByWorktree,
    openFiles: current.openFiles.map((file) =>
      file === sourceOpenFile
        ? {
            ...file,
            id: nextEntityId ?? nextId,
            ...(canonicalEntityId ? { catalogEntityId: canonicalEntityId } : {})
          }
        : file
    )
  }
  if (isTerminalSource) {
    Object.assign(next, {
      tabsByWorktree: terminalTabs,
      ptyIdsByTabId: replaceKey(current.ptyIdsByTabId, sourceEntityId, nextEntityId!),
      terminalLayoutsByTabId: replaceKey(
        current.terminalLayoutsByTabId,
        sourceEntityId,
        nextEntityId!
      ),
      pendingReconnectTabByWorktree: reconnectTabs,
      activeTabId: current.activeTabId === sourceEntityId ? nextEntityId : current.activeTabId
    })
  }
  return next
}

export function migrateSyncedTabIdentity(
  store: StoreApi<AppState>,
  tuple: SyncedIdentityMigrationOptions,
  oldId: string
): string | null {
  const next = planSyncedTabIdentityMigration(store.getState(), tuple, oldId)
  if (!next) {
    return null
  }
  if (Object.keys(next).length > 0) {
    store.setState(next)
  }
  return makeSyncedTabIdentity(tuple, 'tab')
}
