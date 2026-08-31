import {
  makeSyncedTabIdentity,
  type SyncedTabIdentityTuple
} from '../../../shared/synced-tab-identity'
import type { AppState } from '../store/types'
import type { BrowserWorkspace } from '../../../shared/browser-workspace-types'

export type IdentityState = AppState & Record<string, unknown>
export type SyncedIdentityMigrationOptions = SyncedTabIdentityTuple & {
  catalogEntityId?: string
  catalogPageId?: string
  onCollision?: (identity: string) => void
}

function replaceKey<T>(map: Record<string, T>, oldId: string, nextId: string): Record<string, T> {
  if (!(oldId in map) || oldId === nextId) {
    return map
  }
  const result = { ...map }
  result[nextId] = result[oldId]!
  delete result[oldId]
  return result
}

export function browserPageIdentity(tuple: SyncedTabIdentityTuple, pageId: string): string {
  // Namespace prevents a page ID from ever sharing a tab identity.
  return makeSyncedTabIdentity({ ...tuple, catalogTabId: pageId }, 'page')
}

export function migrateBrowserState(
  current: IdentityState,
  tuple: SyncedIdentityMigrationOptions,
  oldId: string,
  nextId: string,
  sourceEntityId: string,
  canonicalEntityId: string,
  requireSource: boolean,
  nextWorkspaceId: string
): Partial<IdentityState> | null {
  const workspaces = current.browserTabsByWorktree[tuple.workspaceKey] ?? []
  const matchingWorkspaces = workspaces.filter(
    (workspace) => workspace.catalogEntityId === canonicalEntityId
  )
  if (matchingWorkspaces.length > 1) {
    tuple.onCollision?.(canonicalEntityId)
    return null
  }
  const source = matchingWorkspaces[0]
  if (!source) {
    if (requireSource) {
      tuple.onCollision?.(canonicalEntityId)
      return null
    }
    return { browserTabsByWorktree: current.browserTabsByWorktree }
  }
  const collision = (identity: string) => {
    tuple.onCollision?.(identity)
    return null
  }
  if (workspaces.some((workspace) => workspace.id === nextWorkspaceId && workspace !== source)) {
    return collision(nextWorkspaceId)
  }
  const pageIds = source.pageIds ?? []
  const pageIdMap = new Map<string, string>()
  const sourcePages = current.browserPagesByWorkspace[source.id] ?? []
  const pageDestinationIds = new Set<string>()
  for (const page of sourcePages) {
    const destinationPageId = browserPageIdentity(tuple, page.catalogPageId ?? page.id)
    if (pageDestinationIds.has(destinationPageId)) {
      return collision(destinationPageId)
    }
    pageDestinationIds.add(destinationPageId)
  }
  const pages = sourcePages.map((page) => {
    const catalogPageId = page.catalogPageId ?? page.id
    const id = browserPageIdentity(tuple, catalogPageId)
    pageIdMap.set(page.id, id)
    return {
      ...page,
      id,
      workspaceId: nextWorkspaceId,
      ...(page.catalogPageId ? {} : { catalogPageId })
    }
  })
  if (nextWorkspaceId in current.browserPagesByWorkspace && source.id !== nextWorkspaceId) {
    return collision(nextWorkspaceId)
  }
  const sourcePageIds = new Set(sourcePages.map((page) => page.id))
  const destinationPageIds = new Set(
    (current.browserPagesByWorkspace[nextWorkspaceId] ?? [])
      .filter((page) => !sourcePageIds.has(page.id))
      .map((page) => page.id)
  )
  for (const pageId of pageIdMap.values()) {
    if (destinationPageIds.has(pageId)) {
      return collision(pageId)
    }
  }
  const remapPage = (id: string | null | undefined) => (id ? (pageIdMap.get(id) ?? id) : id)
  const migratedWorkspace: BrowserWorkspace = {
    ...source,
    id: nextWorkspaceId,
    ...(source.catalogEntityId
      ? { catalogEntityId: source.catalogEntityId }
      : { catalogEntityId: tuple.catalogEntityId ?? source.id }),
    pageIds: pageIds.map((id) => remapPage(id)!),
    activePageId: remapPage(source.activePageId)
  }
  const tabs = Object.fromEntries(
    Object.entries(current.browserTabsByWorktree).map(([worktree, entries]) => [
      worktree,
      worktree === tuple.workspaceKey
        ? entries.map((entry) => (entry.id === source.id ? migratedWorkspace : entry))
        : entries
    ])
  )
  const browserPagesByWorkspace = { ...current.browserPagesByWorkspace, [nextWorkspaceId]: pages }
  if (source.id !== nextWorkspaceId) {
    delete browserPagesByWorkspace[source.id]
  }
  const pageMaps = [
    'browserCertificateFailuresByPageId',
    'browserAnnotationsByPageId',
    'remoteBrowserPageHandlesByPageId',
    'pendingAddressBarFocusByPageId'
  ]
  const migratedMaps: Record<string, unknown> = {}
  for (const key of pageMaps) {
    const map = (current[key] as Record<string, unknown> | undefined) ?? {}
    const nextMap = { ...map }
    for (const [oldPageId, value] of Object.entries(map)) {
      const pageId = pageIdMap.get(oldPageId)
      if (pageId) {
        if (pageId in map && pageId !== oldPageId) {
          return collision(pageId)
        }
        const migratedValue =
          key === 'browserCertificateFailuresByPageId' && value && typeof value === 'object'
            ? { ...(value as Record<string, unknown>), browserPageId: pageId }
            : key === 'browserAnnotationsByPageId' && Array.isArray(value)
              ? value.map((annotation) => ({ ...annotation, browserPageId: pageId }))
              : value
        nextMap[pageId] = migratedValue
        if (pageId !== oldPageId) {
          delete nextMap[oldPageId]
        }
      }
    }
    migratedMaps[key] = nextMap
  }
  let tabFocus = replaceKey(current.pendingAddressBarFocusByTabId ?? {}, oldId, nextId)
  if (nextId in current.pendingAddressBarFocusByTabId && nextId !== oldId && nextId !== source.id) {
    return collision(nextId)
  }
  if (
    nextWorkspaceId in current.pendingAddressBarFocusByTabId &&
    nextWorkspaceId !== oldId &&
    nextWorkspaceId !== source.id
  ) {
    return collision(nextWorkspaceId)
  }
  if (source.id !== oldId) {
    tabFocus = replaceKey(tabFocus, source.id, nextWorkspaceId)
  }
  for (const [oldPageId, pageId] of pageIdMap) {
    if (
      oldPageId !== pageId &&
      oldPageId in current.pendingAddressBarFocusByTabId &&
      pageId in current.pendingAddressBarFocusByTabId
    ) {
      return collision(pageId)
    }
  }
  for (const [oldPageId, pageId] of pageIdMap) {
    tabFocus = replaceKey(tabFocus, oldPageId, pageId)
  }
  const activeByWorktree = { ...current.activeBrowserTabIdByWorktree }
  if (
    activeByWorktree[tuple.workspaceKey] === source.id ||
    activeByWorktree[tuple.workspaceKey] === sourceEntityId
  ) {
    activeByWorktree[tuple.workspaceKey] = nextWorkspaceId
  }
  const matchedSnapshotIds = new Set<string>([source.id])
  const matchedClosedSnapshotIds = new Set<string>()
  for (const entry of current.recentlyClosedBrowserTabsByWorktree[tuple.workspaceKey] ?? []) {
    if (entry.workspace.id === source.id || entry.workspace.catalogEntityId === canonicalEntityId) {
      const ids = entry.pages.map((page) =>
        browserPageIdentity(tuple, page.catalogPageId ?? page.id)
      )
      const seenIds = new Set<string>()
      for (const id of ids) {
        if (seenIds.has(id)) {
          return collision(id)
        }
        seenIds.add(id)
      }
    }
  }
  const recentTabs = Object.fromEntries(
    Object.entries(current.recentlyClosedBrowserTabsByWorktree ?? {}).map(([key, entries]) => [
      key,
      key === tuple.workspaceKey
        ? entries.map((entry) => {
            if (
              entry.workspace.id !== source.id &&
              entry.workspace.catalogEntityId !== canonicalEntityId
            ) {
              return entry
            }
            if (entry.workspace.id !== source.id) {
              matchedClosedSnapshotIds.add(entry.workspace.id)
            }
            matchedSnapshotIds.add(entry.workspace.id)
            const closedPageMap = new Map<string, string>()
            for (const page of entry.pages) {
              const pageId = browserPageIdentity(tuple, page.catalogPageId ?? page.id)
              closedPageMap.set(page.id, pageId)
            }
            const closedPages = entry.pages.map((page) => ({
              ...page,
              id: closedPageMap.get(page.id)!,
              workspaceId: nextWorkspaceId
            }))
            return {
              ...entry,
              workspace: {
                ...entry.workspace,
                id: nextWorkspaceId,
                pageIds: (entry.workspace.pageIds ?? []).map((id) => closedPageMap.get(id) ?? id),
                activePageId: entry.workspace.activePageId
                  ? (closedPageMap.get(entry.workspace.activePageId) ??
                    entry.workspace.activePageId)
                  : entry.workspace.activePageId
              },
              pages: closedPages
            }
          })
        : entries
    ])
  )
  if (matchedClosedSnapshotIds.size > 1) {
    return collision(nextWorkspaceId)
  }
  const recentPages = { ...current.recentlyClosedBrowserPagesByWorkspace }
  for (const snapshotId of matchedSnapshotIds) {
    if (recentPages[snapshotId]) {
      if (nextWorkspaceId in recentPages && snapshotId !== nextWorkspaceId) {
        return collision(nextWorkspaceId)
      }
      const migratedRecentPages = recentPages[snapshotId].map((page) => ({
        ...page,
        id: browserPageIdentity(tuple, page.catalogPageId ?? page.id),
        workspaceId: nextWorkspaceId
      }))
      const seenRecentPageIds = new Set<string>()
      for (const page of migratedRecentPages) {
        if (seenRecentPageIds.has(page.id)) {
          return collision(page.id)
        }
        seenRecentPageIds.add(page.id)
      }
      recentPages[nextWorkspaceId] = migratedRecentPages
      if (snapshotId !== nextWorkspaceId) {
        delete recentPages[snapshotId]
      }
    }
  }
  return {
    browserTabsByWorktree: tabs,
    browserPagesByWorkspace,
    ...migratedMaps,
    pendingAddressBarFocusByTabId: tabFocus,
    activeBrowserTabId:
      current.activeBrowserTabId === oldId || current.activeBrowserTabId === source.id
        ? nextWorkspaceId
        : current.activeBrowserTabId,
    activeBrowserTabIdByWorktree: activeByWorktree,
    recentlyClosedBrowserTabsByWorktree: recentTabs,
    recentlyClosedBrowserPagesByWorkspace: recentPages
  }
}
