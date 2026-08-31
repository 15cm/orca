import type { Tab } from '../../../shared/tab-types'
import type { TerminalTab } from '../../../shared/terminal-tab-types'
import type {
  SharedTabCatalogChange,
  SharedTabCatalogKey
} from '../../../shared/shared-tab-catalog-types'
import { useAppStore } from '../store'
import { makeSyncedTabIdentity } from '../../../shared/synced-tab-identity'
import { planSyncedTabIdentityMigration } from './synced-tab-identity-migration'

function compositeTabId(key: SharedTabCatalogKey, tabId: string): string {
  return JSON.stringify([key.executionHostId, key.workspaceKey, tabId])
}
function catalogTabId(entry: { tabId: string; catalogTabId?: string }): string {
  return entry.catalogTabId ?? entry.tabId
}
function tabIdentity(
  key: SharedTabCatalogKey,
  entry: { tabId: string; catalogTabId?: string }
): string {
  return makeSyncedTabIdentity({ ...key, catalogTabId: catalogTabId(entry) }, 'tab')
}
function entityIdentity(key: SharedTabCatalogKey, catalogId: string): string {
  return makeSyncedTabIdentity({ ...key, catalogTabId: catalogId }, 'entity')
}
function pageIdentity(key: SharedTabCatalogKey, catalogId: string): string {
  return makeSyncedTabIdentity({ ...key, catalogTabId: catalogId }, 'page')
}
function browserPageInternalId(key: SharedTabCatalogKey, id: string): string {
  return pageIdentity(key, id)
}

function activeGroup(
  groups: ReturnType<typeof useAppStore.getState>['groupsByWorktree'][string] | undefined,
  activeId: string | undefined
) {
  return activeId ? groups?.find((group) => group.id === activeId) : undefined
}

function removeOptimisticBacking(
  state: ReturnType<typeof useAppStore.getState>,
  source: Tab,
  workspaceKey: string
): Partial<ReturnType<typeof useAppStore.getState>> {
  const ptyIdsByTabId = { ...state.ptyIdsByTabId }
  delete ptyIdsByTabId[source.entityId]
  const terminalLayoutsByTabId = { ...state.terminalLayoutsByTabId }
  delete terminalLayoutsByTabId[source.entityId]
  const browserPagesByWorkspace = { ...state.browserPagesByWorkspace }
  delete browserPagesByWorkspace[source.entityId]
  return {
    ptyIdsByTabId,
    terminalLayoutsByTabId,
    tabsByWorktree: {
      ...state.tabsByWorktree,
      [workspaceKey]: (state.tabsByWorktree[workspaceKey] ?? []).filter(
        (item) => item.id !== source.entityId
      )
    },
    openFiles: state.openFiles.filter(
      (file) => file.id !== source.entityId || file.worktreeId !== workspaceKey
    ),
    browserTabsByWorktree: {
      ...state.browserTabsByWorktree,
      [workspaceKey]: (state.browserTabsByWorktree[workspaceKey] ?? []).filter(
        (item) => item.id !== source.entityId
      )
    },
    browserPagesByWorkspace
  }
}

export function applySharedTabCatalogChange(
  change: SharedTabCatalogChange,
  store: typeof useAppStore = useAppStore,
  applyingRemote: { current: boolean; depth?: number } = { current: false }
): void {
  const mutation = change.mutation
  const tab = change.tab
  const candidateId = tab
    ? catalogTabId(tab)
    : mutation.kind === 'create'
      ? catalogTabId(mutation.tab)
      : mutation.tabId
  const exact = store
    .getState()
    .unifiedTabsByWorktree[mutation.key.workspaceKey]?.find(
      (candidate) =>
        compositeTabId(
          {
            executionHostId: candidate.executionHostId ?? 'local',
            workspaceKey: candidate.worktreeId
          },
          candidate.catalogTabId ?? candidate.id
        ) === compositeTabId(mutation.key, candidateId)
    )
  applyingRemote.depth = (applyingRemote.depth ?? 0) + 1
  applyingRemote.current = true
  try {
    if (mutation.kind === 'create' && tab) {
      const internalTabId = tabIdentity(mutation.key, tab)
      const catalogEntityId = tab.metadata.catalogEntityId ?? tab.metadata.entityId
      const internalEntityId = entityIdentity(mutation.key, catalogEntityId)
      store.setState((state) => {
        const groups = state.groupsByWorktree[mutation.key.workspaceKey] ?? []
        const group = activeGroup(
          groups,
          state.activeGroupIdByWorktree[mutation.key.workspaceKey]
        ) ?? {
          id: crypto.randomUUID(),
          worktreeId: mutation.key.workspaceKey,
          activeTabId: null,
          tabOrder: [],
          recentTabIds: []
        }
        const source = exact
        const contentKind =
          tab.contentType === 'browser'
            ? 'browser'
            : tab.contentType === 'terminal'
              ? 'terminal'
              : tab.contentType === 'simulator'
                ? 'simulator'
                : 'editor'
        const compatible =
          !source ||
          (source.contentType === tab.contentType &&
            (source.catalogEntityId ?? source.entityId) === catalogEntityId &&
            (!tab.backingState || tab.backingState.kind === contentKind))
        // Planner adoption requires exactly one terminal backing row. A unified
        // terminal can precede that row while its pane is still mounting.
        const terminalBackings =
          tab.contentType === 'terminal' && source
            ? (state.tabsByWorktree[mutation.key.workspaceKey] ?? []).filter(
                (item) => item.id === source.entityId
              )
            : []
        const planningState =
          tab.contentType === 'terminal' && source && terminalBackings.length === 0
            ? {
                ...state,
                tabsByWorktree: {
                  ...state.tabsByWorktree,
                  [mutation.key.workspaceKey]: [
                    {
                      id: source.entityId,
                      catalogTabId: catalogTabId(tab),
                      catalogEntityId,
                      ptyId:
                        tab.terminalBinding?.ptyId ??
                        (tab.backingState?.kind === 'terminal'
                          ? (tab.backingState.ptyIds[0] ?? null)
                          : null),
                      worktreeId: mutation.key.workspaceKey,
                      title: source.label,
                      customTitle: source.customLabel,
                      color: source.color,
                      sortOrder: source.sortOrder,
                      createdAt: source.createdAt
                    } as TerminalTab
                  ]
                }
              }
            : state
        // A compatible optimistic row is an identity migration, not a new row.
        // Keep the planner's patch as the transaction base so every alias and
        // backing map is moved before canonical fields are applied.
        const plannedMigration =
          source && compatible
            ? planSyncedTabIdentityMigration(
                planningState,
                {
                  executionHostId: mutation.key.executionHostId,
                  workspaceKey: mutation.key.workspaceKey,
                  catalogTabId: catalogTabId(tab),
                  catalogEntityId,
                  onCollision: () => undefined
                },
                source.id
              )
            : undefined
        if (source && compatible && !plannedMigration) {
          return state
        }
        const transaction = { ...planningState, ...plannedMigration }
        if (source && compatible) {
          const migratedTab = transaction.unifiedTabsByWorktree[mutation.key.workspaceKey]?.find(
            (candidate) => candidate.id === internalTabId
          )
          if (!migratedTab) {
            return state
          }
          const sharedFields = {
            label: tab.metadata.label,
            customLabel: tab.metadata.customLabel,
            color: tab.metadata.color,
            isPinned: tab.metadata.isPinned,
            isPreview: tab.metadata.isPreview,
            viewMode: tab.metadata.viewMode,
            catalogTabId: catalogTabId(tab),
            catalogEntityId
          }
          const unifiedTabsByWorktree = {
            ...transaction.unifiedTabsByWorktree,
            [mutation.key.workspaceKey]: (
              transaction.unifiedTabsByWorktree[mutation.key.workspaceKey] ?? []
            ).map((candidate) =>
              candidate === migratedTab ? { ...candidate, ...sharedFields } : candidate
            )
          }
          const result: Partial<ReturnType<typeof store.getState>> = {
            ...plannedMigration,
            unifiedTabsByWorktree
          }
          if (tab.contentType === 'terminal') {
            result.tabsByWorktree = {
              ...transaction.tabsByWorktree,
              [mutation.key.workspaceKey]: (
                transaction.tabsByWorktree[mutation.key.workspaceKey] ?? []
              ).map((candidate) =>
                candidate.id === internalEntityId
                  ? { ...candidate, catalogTabId: catalogTabId(tab), catalogEntityId }
                  : candidate
              )
            }
          } else if (tab.backingState?.kind === 'editor') {
            const editorBacking = tab.backingState
            const matchingFiles = transaction.openFiles.filter(
              (file) =>
                file.id === internalEntityId && file.worktreeId === mutation.key.workspaceKey
            )
            const editor = {
              id: internalEntityId,
              catalogEntityId,
              filePath: editorBacking.filePath ?? catalogEntityId,
              relativePath: editorBacking.filePath ?? catalogEntityId,
              worktreeId: mutation.key.workspaceKey,
              language: editorBacking.language ?? '',
              isDirty: false,
              mode: 'edit' as const
            }
            result.openFiles =
              matchingFiles.length > 0
                ? transaction.openFiles.map((file) =>
                    file.id === internalEntityId && file.worktreeId === mutation.key.workspaceKey
                      ? {
                          ...file,
                          catalogEntityId,
                          filePath: editor.filePath,
                          language: editor.language
                        }
                      : file
                  )
                : [...transaction.openFiles, editor]
          } else if (tab.backingState?.kind === 'browser') {
            const pageIds = (tab.backingState.catalogPageIds ?? tab.backingState.pages ?? []).map(
              (id) => browserPageInternalId(mutation.key, id)
            )
            result.browserTabsByWorktree = {
              ...transaction.browserTabsByWorktree,
              [mutation.key.workspaceKey]: (
                transaction.browserTabsByWorktree[mutation.key.workspaceKey] ?? []
              ).map((workspace) =>
                workspace.id === internalEntityId
                  ? { ...workspace, catalogEntityId, pageIds }
                  : workspace
              )
            }
          }
          return result
        }
        const tabCollision = state.unifiedTabsByWorktree[mutation.key.workspaceKey]?.some(
          (candidate) =>
            candidate !== source &&
            (candidate.executionHostId ?? 'local') === mutation.key.executionHostId &&
            candidate.worktreeId === mutation.key.workspaceKey &&
            (candidate.id === internalTabId || candidate.entityId === internalEntityId)
        )
        if (source && (!compatible || tabCollision)) {
          const remaining = (state.unifiedTabsByWorktree[mutation.key.workspaceKey] ?? []).filter(
            (candidate) => candidate !== source
          )
          const sourceGroup = groups.map((item) => ({
            ...item,
            activeTabId: item.activeTabId === source.id ? null : item.activeTabId,
            tabOrder: item.tabOrder.filter((id) => id !== source.id),
            recentTabIds: item.recentTabIds?.filter((id) => id !== source.id)
          }))
          const next: Partial<ReturnType<typeof store.getState>> = {
            unifiedTabsByWorktree: {
              ...state.unifiedTabsByWorktree,
              [mutation.key.workspaceKey]: remaining
            },
            groupsByWorktree: {
              ...state.groupsByWorktree,
              [mutation.key.workspaceKey]: sourceGroup
            }
          }
          if (
            !remaining.some(
              (candidate) =>
                candidate.entityId === source.entityId &&
                (candidate.executionHostId ?? 'local') === mutation.key.executionHostId
            )
          ) {
            Object.assign(next, removeOptimisticBacking(state, source, mutation.key.workspaceKey))
          }
          return next
        }
        const created = {
          id: internalTabId,
          catalogTabId: catalogTabId(tab),
          catalogEntityId,
          entityId: internalEntityId,
          groupId: group.id,
          worktreeId: mutation.key.workspaceKey,
          executionHostId: mutation.key.executionHostId,
          contentType: tab.contentType as Tab['contentType'],
          label: tab.metadata.label,
          customLabel: tab.metadata.customLabel,
          color: tab.metadata.color,
          isPinned: tab.metadata.isPinned,
          isPreview: tab.metadata.isPreview,
          viewMode: tab.metadata.viewMode,
          sortOrder: (state.unifiedTabsByWorktree[mutation.key.workspaceKey] ?? []).length,
          createdAt: Date.now()
        }
        const adopted = source
          ? {
              ...source,
              id: internalTabId,
              entityId: internalEntityId,
              catalogTabId: catalogTabId(tab),
              catalogEntityId,
              label: tab.metadata.label,
              customLabel: tab.metadata.customLabel,
              color: tab.metadata.color,
              isPinned: tab.metadata.isPinned,
              viewMode: tab.metadata.viewMode
            }
          : created
        const base = {
          unifiedTabsByWorktree: {
            ...state.unifiedTabsByWorktree,
            [mutation.key.workspaceKey]: source
              ? (state.unifiedTabsByWorktree[mutation.key.workspaceKey] ?? []).map((item) =>
                  item === source ? adopted : item
                )
              : [...(state.unifiedTabsByWorktree[mutation.key.workspaceKey] ?? []), created]
          },
          groupsByWorktree: {
            ...state.groupsByWorktree,
            [mutation.key.workspaceKey]: groups.length
              ? groups.map((item) => ({
                  ...item,
                  activeTabId: item.activeTabId === source?.id ? internalTabId : item.activeTabId,
                  tabOrder: item.tabOrder.map((id) => (id === source?.id ? internalTabId : id)),
                  recentTabIds: item.recentTabIds?.map((id) =>
                    id === source?.id ? internalTabId : id
                  )
                }))
              : [{ ...group, tabOrder: [internalTabId] }]
          }
        }
        const ptyId =
          tab.terminalBinding?.ptyId ??
          (tab.backingState?.kind === 'terminal' ? tab.backingState.ptyIds[0] : undefined)
        const pty = ptyId
          ? { ...transaction.ptyIdsByTabId, [internalEntityId]: [ptyId] }
          : transaction.ptyIdsByTabId
        const priorLayout = source ? transaction.terminalLayoutsByTabId[source.entityId] : undefined
        const layout = ptyId
          ? {
              ...transaction.terminalLayoutsByTabId,
              [internalEntityId]: priorLayout ?? {
                root: { type: 'leaf', leafId: crypto.randomUUID() },
                activeLeafId: null,
                expandedLeafId: null,
                ptyIdsByLeafId: {}
              }
            }
          : transaction.terminalLayoutsByTabId
        const terminalTabs =
          source && tab.contentType === 'terminal'
            ? {
                ...transaction.tabsByWorktree,
                [mutation.key.workspaceKey]: (
                  transaction.tabsByWorktree[mutation.key.workspaceKey] ?? []
                ).map((item) =>
                  item.id === source.entityId
                    ? {
                        ...item,
                        id: internalEntityId,
                        catalogTabId: catalogTabId(tab),
                        catalogEntityId
                      }
                    : item
                )
              }
            : transaction.tabsByWorktree
        const editor =
          tab.backingState?.kind === 'editor'
            ? {
                id: internalEntityId,
                catalogEntityId,
                filePath: tab.backingState.filePath ?? catalogEntityId,
                relativePath: tab.backingState.filePath ?? catalogEntityId,
                worktreeId: mutation.key.workspaceKey,
                language: tab.backingState.language ?? '',
                isDirty: false
              }
            : null
        const browser =
          tab.backingState?.kind === 'browser'
            ? {
                id: internalEntityId,
                catalogEntityId,
                worktreeId: mutation.key.workspaceKey,
                pageIds: (tab.backingState.catalogPageIds ?? tab.backingState.pages ?? []).map(
                  (id) => browserPageInternalId(mutation.key, id)
                ),
                url: 'about:blank',
                title: '',
                loading: false,
                faviconUrl: null,
                canGoBack: false,
                canGoForward: false,
                loadError: null,
                createdAt: Date.now()
              }
            : null
        const pages =
          tab.backingState?.kind === 'browser'
            ? Object.fromEntries(
                (tab.backingState.catalogPageIds ?? tab.backingState.pages ?? []).map(
                  (id, index) => {
                    const pageId = browserPageInternalId(mutation.key, id)
                    const prior = (
                      transaction.browserPagesByWorkspace[source?.entityId ?? internalEntityId] ??
                      []
                    ).find((page) => page.id === pageId)
                    return [
                      pageId,
                      prior ?? {
                        id: pageId,
                        catalogPageId: id,
                        workspaceId: internalEntityId,
                        worktreeId: mutation.key.workspaceKey,
                        url: 'about:blank',
                        title: '',
                        loading: false,
                        faviconUrl: null,
                        canGoBack: false,
                        canGoForward: false,
                        loadError: null,
                        createdAt: index
                      }
                    ]
                  }
                )
              )
            : transaction.browserPagesByWorkspace
        const pageMap = { ...pages }
        if (source && source.entityId !== internalEntityId) {
          delete pageMap[source.entityId]
        }
        const browserRows = browser
          ? (transaction.browserTabsByWorktree[mutation.key.workspaceKey] ?? []).some(
              (item) => item.id === (source?.entityId ?? internalEntityId)
            )
            ? (transaction.browserTabsByWorktree[mutation.key.workspaceKey] ?? []).map((item) =>
                item.id === (source?.entityId ?? internalEntityId) ? browser : item
              )
            : [...(transaction.browserTabsByWorktree[mutation.key.workspaceKey] ?? []), browser]
          : transaction.browserTabsByWorktree[mutation.key.workspaceKey]
        const editorRows = editor
          ? transaction.openFiles.some(
              (file) =>
                file.id === (source?.entityId ?? internalEntityId) &&
                file.worktreeId === mutation.key.workspaceKey
            )
            ? transaction.openFiles.map((file) =>
                file.id === (source?.entityId ?? internalEntityId) &&
                file.worktreeId === mutation.key.workspaceKey
                  ? editor
                  : file
              )
            : [...transaction.openFiles, editor]
          : transaction.openFiles
        return {
          ...plannedMigration,
          ...base,
          ptyIdsByTabId: pty,
          terminalLayoutsByTabId: layout,
          tabsByWorktree: terminalTabs,
          ...(editor ? { openFiles: editorRows } : {}),
          ...(browser
            ? {
                browserTabsByWorktree: {
                  ...transaction.browserTabsByWorktree,
                  [mutation.key.workspaceKey]: browserRows
                }
              }
            : {}),
          browserPagesByWorkspace: pageMap
        } as Partial<ReturnType<typeof store.getState>>
      })
      return
    }
    // Canonical tombstones/conflicting creates reject the local optimistic
    // record. Closing under the remote guard prevents an echo mutation.
    if (!tab && exact && (mutation.kind === 'create' || mutation.kind === 'patch')) {
      store.setState((state) => {
        const tabs = state.unifiedTabsByWorktree[mutation.key.workspaceKey] ?? []
        const remaining = tabs.filter((candidate) => candidate !== exact)
        const sameEntity = remaining.some(
          (candidate) =>
            candidate.entityId === exact.entityId &&
            (candidate.executionHostId ?? 'local') === mutation.key.executionHostId
        )
        const groupsByWorktree = {
          ...state.groupsByWorktree,
          [mutation.key.workspaceKey]: (
            state.groupsByWorktree[mutation.key.workspaceKey] ?? []
          ).map((group) => ({
            ...group,
            activeTabId: group.activeTabId === exact.id ? null : group.activeTabId,
            tabOrder: group.tabOrder.filter((id) => id !== exact.id),
            recentTabIds: group.recentTabIds?.filter((id) => id !== exact.id)
          }))
        }
        const next: Partial<ReturnType<typeof store.getState>> = {
          unifiedTabsByWorktree: {
            ...state.unifiedTabsByWorktree,
            [mutation.key.workspaceKey]: remaining
          },
          groupsByWorktree
        }
        if (!sameEntity) {
          Object.assign(next, removeOptimisticBacking(state, exact, mutation.key.workspaceKey))
        }
        return next
      })
      return
    }
    if (mutation.kind === 'close') {
      if (exact) {
        store.setState((state) => {
          const tabs = state.unifiedTabsByWorktree[mutation.key.workspaceKey] ?? []
          const remains = tabs.some(
            (candidate) =>
              candidate !== exact &&
              (candidate.executionHostId ?? 'local') === mutation.key.executionHostId &&
              candidate.entityId === exact.entityId
          )
          const ptyIdsByTabId = { ...state.ptyIdsByTabId }
          if (!remains) {
            delete ptyIdsByTabId[exact.entityId]
          }
          const groupsByWorktree = {
            ...state.groupsByWorktree,
            [mutation.key.workspaceKey]: (
              state.groupsByWorktree[mutation.key.workspaceKey] ?? []
            ).map((group) => ({
              ...group,
              activeTabId: group.activeTabId === exact.id ? null : group.activeTabId,
              tabOrder: group.tabOrder.filter((id) => id !== exact.id),
              recentTabIds: group.recentTabIds?.filter((id) => id !== exact.id)
            }))
          }
          const result: Partial<ReturnType<typeof store.getState>> = {
            unifiedTabsByWorktree: {
              ...state.unifiedTabsByWorktree,
              [mutation.key.workspaceKey]: tabs.filter((candidate) => candidate !== exact)
            },
            groupsByWorktree,
            ptyIdsByTabId
          }
          if (!remains) {
            result.openFiles = state.openFiles.filter(
              (file) => file.id !== exact.entityId && file.catalogEntityId !== exact.catalogEntityId
            )
            result.browserTabsByWorktree = {
              ...state.browserTabsByWorktree,
              [mutation.key.workspaceKey]: (
                state.browserTabsByWorktree[mutation.key.workspaceKey] ?? []
              ).filter(
                (workspace) =>
                  workspace.id !== exact.entityId &&
                  workspace.catalogEntityId !== exact.catalogEntityId
              )
            }
            result.browserPagesByWorkspace = { ...state.browserPagesByWorkspace }
            delete result.browserPagesByWorkspace[exact.entityId]
          }
          return result
        })
      }
      return
    }
    if (!exact || !tab) {
      return
    }
    const editorBacking = tab.backingState?.kind === 'editor' ? tab.backingState : null
    const browserBacking = tab.backingState?.kind === 'browser' ? tab.backingState : null
    store.setState(
      (state) =>
        ({
          unifiedTabsByWorktree: {
            ...state.unifiedTabsByWorktree,
            [mutation.key.workspaceKey]: (
              state.unifiedTabsByWorktree[mutation.key.workspaceKey] ?? []
            ).map((candidate) =>
              compositeTabId(
                {
                  executionHostId: candidate.executionHostId ?? 'local',
                  workspaceKey: candidate.worktreeId
                },
                candidate.catalogTabId ?? candidate.id
              ) === compositeTabId(mutation.key, catalogTabId(tab))
                ? {
                    ...candidate,
                    label: tab.metadata.label ?? candidate.label,
                    customLabel:
                      tab.metadata.customLabel !== undefined
                        ? tab.metadata.customLabel
                        : candidate.customLabel,
                    color: tab.metadata.color !== undefined ? tab.metadata.color : candidate.color,
                    isPinned:
                      tab.metadata.isPinned !== undefined
                        ? tab.metadata.isPinned
                        : candidate.isPinned,
                    viewMode:
                      tab.metadata.viewMode !== undefined
                        ? tab.metadata.viewMode
                        : candidate.viewMode,
                    catalogTabId: catalogTabId(tab),
                    catalogEntityId: tab.metadata.catalogEntityId ?? tab.metadata.entityId
                  }
                : candidate
            )
          },
          ...(editorBacking
            ? {
                openFiles: state.openFiles.some(
                  (file) =>
                    (file.id === exact.entityId ||
                      file.catalogEntityId ===
                        (tab.metadata.catalogEntityId ?? tab.metadata.entityId)) &&
                    file.worktreeId === mutation.key.workspaceKey
                )
                  ? state.openFiles.map((file) =>
                      (file.id === exact.entityId ||
                        file.catalogEntityId ===
                          (tab.metadata.catalogEntityId ?? tab.metadata.entityId)) &&
                      file.worktreeId === mutation.key.workspaceKey
                        ? {
                            ...file,
                            catalogEntityId: tab.metadata.catalogEntityId ?? tab.metadata.entityId,
                            filePath: editorBacking.filePath ?? file.filePath,
                            language: editorBacking.language ?? file.language
                          }
                        : file
                    )
                  : [
                      ...state.openFiles,
                      {
                        id: exact.entityId,
                        catalogEntityId: tab.metadata.catalogEntityId ?? tab.metadata.entityId,
                        filePath: editorBacking.filePath ?? exact.entityId,
                        relativePath: editorBacking.filePath ?? exact.entityId,
                        worktreeId: exact.worktreeId,
                        language: editorBacking.language ?? '',
                        isDirty: false
                      } as never
                    ]
              }
            : {}),
          ...(browserBacking
            ? {
                browserTabsByWorktree: {
                  ...state.browserTabsByWorktree,
                  [exact.worktreeId]: (state.browserTabsByWorktree[exact.worktreeId] ?? []).some(
                    (workspace) =>
                      workspace.id === exact.entityId ||
                      workspace.catalogEntityId ===
                        (tab.metadata.catalogEntityId ?? tab.metadata.entityId)
                  )
                    ? (state.browserTabsByWorktree[exact.worktreeId] ?? []).map((workspace) =>
                        workspace.id === exact.entityId ||
                        workspace.catalogEntityId ===
                          (tab.metadata.catalogEntityId ?? tab.metadata.entityId)
                          ? {
                              ...workspace,
                              catalogEntityId:
                                tab.metadata.catalogEntityId ?? tab.metadata.entityId,
                              pageIds:
                                (browserBacking.catalogPageIds ?? browserBacking.pages)?.map((id) =>
                                  browserPageInternalId(mutation.key, id)
                                ) ?? workspace.pageIds
                            }
                          : workspace
                      )
                    : [
                        ...(state.browserTabsByWorktree[exact.worktreeId] ?? []),
                        {
                          id: exact.entityId,
                          catalogEntityId: tab.metadata.catalogEntityId ?? tab.metadata.entityId,
                          worktreeId: exact.worktreeId,
                          pageIds:
                            (browserBacking.catalogPageIds ?? browserBacking.pages)?.map((id) =>
                              browserPageInternalId(mutation.key, id)
                            ) ?? []
                        }
                      ]
                }
              }
            : {}),
          ...(browserBacking
            ? {
                browserPagesByWorkspace: {
                  ...state.browserPagesByWorkspace,
                  [exact.entityId]: (
                    browserBacking.catalogPageIds ??
                    browserBacking.pages ??
                    []
                  ).map((catalogId, index) => {
                    const id = browserPageInternalId(mutation.key, catalogId)
                    const prior = (state.browserPagesByWorkspace[exact.entityId] ?? []).find(
                      (page) => page.id === id
                    )
                    return prior
                      ? { ...prior, catalogPageId: catalogId }
                      : {
                          id,
                          catalogPageId: catalogId,
                          workspaceId: exact.entityId,
                          worktreeId: exact.worktreeId,
                          url: 'about:blank',
                          title: '',
                          loading: false,
                          faviconUrl: null,
                          canGoBack: false,
                          canGoForward: false,
                          loadError: null,
                          createdAt: index
                        }
                  })
                }
              }
            : {}),
          ...(mutation.kind === 'bind-terminal' || tab.terminalBinding !== undefined
            ? {
                ptyIdsByTabId: {
                  ...state.ptyIdsByTabId,
                  [exact.entityId]: (
                    mutation.kind === 'bind-terminal'
                      ? mutation.terminalBinding
                      : tab.terminalBinding
                  )
                    ? [
                        (mutation.kind === 'bind-terminal'
                          ? mutation.terminalBinding
                          : tab.terminalBinding)!.ptyId
                      ]
                    : []
                }
              }
            : {})
        }) as Partial<ReturnType<typeof store.getState>>
    )
  } finally {
    applyingRemote.depth -= 1
    applyingRemote.current = applyingRemote.depth > 0
  }
}
