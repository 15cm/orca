import { useEffect, useRef } from 'react'
import { useAppStore } from '../store'
import type { Tab } from '../../../shared/tab-types'
import type {
  SharedTabCatalogChange,
  SharedTabCatalogEntry,
  SharedTabCatalogKey
} from '../../../shared/shared-tab-catalog-types'
import { applySharedTabCatalogChange as applyCanonicalSharedTabCatalogChange } from '../lib/shared-tab-catalog-reconciliation'
import { makeSyncedTabIdentity } from '../../../shared/synced-tab-identity'
import { migrateSyncedTabIdentity } from '../lib/synced-tab-identity-migration'
function keyForTab(tab: Tab): SharedTabCatalogKey {
  return { executionHostId: tab.executionHostId ?? 'local', workspaceKey: tab.worktreeId }
}
function identityForTab(tab: Tab): string {
  return JSON.stringify([
    tab.executionHostId ?? 'local',
    tab.worktreeId,
    tab.catalogTabId ?? tab.id
  ])
}
function compositeTabId(key: SharedTabCatalogKey, tabId: string): string {
  return JSON.stringify([key.executionHostId, key.workspaceKey, tabId])
}
function compatibleCreate(tab: Tab, canonical: SharedTabCatalogEntry): boolean {
  const canonicalEntityId = canonical.metadata.catalogEntityId ?? canonical.metadata.entityId
  const localEntityId = tab.catalogEntityId ?? tab.entityId
  const kind =
    tab.contentType === 'browser'
      ? 'browser'
      : tab.contentType === 'terminal'
        ? 'terminal'
        : tab.contentType === 'simulator'
          ? 'simulator'
          : 'editor'
  return (
    tab.contentType === canonical.contentType &&
    localEntityId === canonicalEntityId &&
    (!canonical.backingState || canonical.backingState.kind === kind)
  )
}
export function projectSharedTabEntry(
  tab: Tab,
  state: ReturnType<typeof useAppStore.getState>
): SharedTabCatalogEntry {
  const catalogTabId = tab.catalogTabId ?? tab.id
  const catalogEntityId = tab.catalogEntityId ?? tab.entityId
  const key = keyForTab(tab)
  const internalEntityId = makeSyncedTabIdentity(
    {
      executionHostId: key.executionHostId,
      workspaceKey: key.workspaceKey,
      catalogTabId: catalogEntityId
    },
    'entity'
  )
  const ptyId =
    tab.contentType === 'terminal'
      ? (state.ptyIdsByTabId[internalEntityId] ?? state.ptyIdsByTabId[tab.entityId])?.[0]
      : undefined
  const file =
    tab.contentType !== 'terminal' &&
    tab.contentType !== 'browser' &&
    tab.contentType !== 'simulator'
      ? state.openFiles.find(
          (candidate) =>
            (candidate.id === tab.entityId ||
              candidate.catalogEntityId === catalogEntityId ||
              candidate.id === internalEntityId) &&
            candidate.worktreeId === tab.worktreeId
        )
      : undefined
  const browserWorkspace =
    tab.contentType === 'browser'
      ? state.browserTabsByWorktree[tab.worktreeId]?.find(
          (candidate) =>
            candidate.id === tab.entityId ||
            candidate.catalogEntityId === catalogEntityId ||
            candidate.id === internalEntityId
        )
      : undefined
  const browserPages = browserWorkspace
    ? (state.browserPagesByWorkspace[browserWorkspace.id] ?? [])
    : []
  return {
    tabId: catalogTabId,
    catalogTabId,
    contentType: tab.contentType,
    metadata: {
      label: tab.label,
      customLabel: tab.customLabel,
      color: tab.color,
      isPinned: tab.isPinned,
      isPreview: tab.isPreview,
      entityId: internalEntityId,
      catalogEntityId,
      viewMode: tab.viewMode
    },
    backingState:
      tab.contentType === 'terminal'
        ? { kind: 'terminal', ptyIds: ptyId ? [ptyId] : [] }
        : tab.contentType === 'browser'
          ? {
              kind: 'browser',
              browserWorkspaceId: browserWorkspace?.id ?? internalEntityId,
              catalogEntityId,
              pages: browserPages.length
                ? browserPages.map((page) => page.catalogPageId ?? page.id)
                : (browserWorkspace?.pageIds ?? []),
              catalogPageIds: browserPages.length
                ? browserPages.map((page) => page.catalogPageId ?? page.id)
                : (browserWorkspace?.pageIds ?? [])
            }
          : tab.contentType === 'simulator'
            ? { kind: 'simulator', simulatorId: internalEntityId }
            : {
                kind: 'editor',
                filePath: file?.filePath ?? tab.entityId,
                language: file?.language
              },
    ...(ptyId ? { terminalBinding: { ptyId } } : {})
  }
}

function isSameEntry(
  tab: Tab,
  entry: SharedTabCatalogEntry,
  state: ReturnType<typeof useAppStore.getState>
): boolean {
  const metadata = entry.metadata
  return (
    tab.contentType === entry.contentType &&
    tab.label === metadata.label &&
    tab.customLabel === metadata.customLabel &&
    tab.color === metadata.color &&
    tab.isPinned === metadata.isPinned &&
    tab.isPreview === metadata.isPreview &&
    (tab.catalogEntityId ?? tab.entityId) === (metadata.catalogEntityId ?? metadata.entityId) &&
    tab.viewMode === metadata.viewMode &&
    JSON.stringify(entry.backingState) ===
      JSON.stringify(projectSharedTabEntry(tab, state).backingState) &&
    (tab.contentType !== 'terminal' ||
      state.ptyIdsByTabId[tab.id]?.[0] === entry.terminalBinding?.ptyId)
  )
}

/** Publishes common tab lifecycle state while leaving local placement and focus untouched. */
export function useSharedTabCatalogSync(): void {
  const applyingRemote = useRef(false)
  const bootstrapped = useRef(false)
  const published = useRef(new Map<string, SharedTabCatalogEntry>())
  const appliedRevisions = useRef(new Map<string, number>())
  const resolvedCreates = useRef(new Map<string, 'committed' | 'rejected'>())

  useEffect(() => {
    let disposed = false
    let acceptingEvents = false
    const queuedEvents: SharedTabCatalogChange[] = []
    const submit = async (
      mutation: Parameters<typeof window.api.app.tabs.catalogMutate>[0],
      tab?: Tab
    ): Promise<void> => {
      const result = await window.api.app.tabs.catalogMutate(mutation)
      const revisionKey = JSON.stringify([mutation.key.executionHostId, mutation.key.workspaceKey])
      if (
        mutation.kind === 'create' &&
        resolvedCreates.current.has(mutation.mutationId) &&
        result?.revision !== undefined
      ) {
        appliedRevisions.current.set(
          revisionKey,
          Math.max(appliedRevisions.current.get(revisionKey) ?? 0, result.revision)
        )
      }
      const resultTabId = mutation.kind === 'create' ? mutation.tab.tabId : mutation.tabId
      const resultIdentity = compositeTabId(mutation.key, resultTabId)
      if (result?.tab) {
        published.current.set(resultIdentity, result.tab)
        if (
          mutation.kind === 'create' &&
          tab &&
          !resolvedCreates.current.has(mutation.mutationId)
        ) {
          applyingRemote.current = true
          try {
            applyCanonicalSharedTabCatalogChange(
              { revision: result.revision ?? 0, mutation, tab: result.tab },
              useAppStore,
              applyingRemote
            )
            resolvedCreates.current.set(
              mutation.mutationId,
              compatibleCreate(tab, result.tab) ? 'committed' : 'rejected'
            )
            if (result.revision !== undefined) {
              appliedRevisions.current.set(
                revisionKey,
                Math.max(appliedRevisions.current.get(revisionKey) ?? 0, result.revision)
              )
            }
          } finally {
            applyingRemote.current = false
          }
        }
      } else if (
        result &&
        (mutation.kind === 'create' || mutation.kind === 'patch' || mutation.kind === 'close')
      ) {
        published.current.delete(resultIdentity)
      }
      const targetCatalogTabId =
        mutation.kind === 'create'
          ? (mutation.tab.catalogTabId ?? mutation.tab.tabId)
          : mutation.tabId
      const exact = tab
        ? useAppStore
            .getState()
            .unifiedTabsByWorktree[mutation.key.workspaceKey]?.find(
              (candidate) =>
                compositeTabId(
                  {
                    executionHostId: candidate.executionHostId ?? 'local',
                    workspaceKey: candidate.worktreeId
                  },
                  candidate.catalogTabId ?? candidate.id
                ) === compositeTabId(mutation.key, targetCatalogTabId)
            )
        : null
      if (
        tab &&
        exact &&
        (!result || result.tab === null) &&
        (mutation.kind === 'create' || mutation.kind === 'patch') &&
        !resolvedCreates.current.has(mutation.mutationId)
      ) {
        applyingRemote.current = true
        try {
          applyCanonicalSharedTabCatalogChange(
            { revision: result?.revision ?? 0, mutation, tab: null },
            useAppStore,
            applyingRemote
          )
          if (mutation.kind === 'create') {
            resolvedCreates.current.set(mutation.mutationId, 'rejected')
          }
          if (result?.revision !== undefined) {
            appliedRevisions.current.set(
              revisionKey,
              Math.max(appliedRevisions.current.get(revisionKey) ?? 0, result.revision)
            )
          }
        } finally {
          applyingRemote.current = false
        }
      }
    }
    const publish = (tab: Tab, state = useAppStore.getState()): void => {
      if (!bootstrapped.current || applyingRemote.current) {
        return
      }
      const entry = projectSharedTabEntry(tab, state)
      const identity = identityForTab(tab)
      const previous = published.current.get(identity)
      if (previous && isSameEntry(tab, previous, state)) {
        return
      }
      published.current.set(identity, entry)
      if (previous) {
        void submit({
          mutationId: crypto.randomUUID(),
          kind: 'patch',
          key: keyForTab(tab),
          tabId: tab.catalogTabId ?? tab.id,
          metadata: entry.metadata,
          backingState: entry.backingState
        })
        if (entry.terminalBinding?.ptyId !== previous.terminalBinding?.ptyId) {
          void submit({
            mutationId: crypto.randomUUID(),
            kind: 'bind-terminal',
            key: keyForTab(tab),
            tabId: tab.catalogTabId ?? tab.id,
            terminalBinding: entry.terminalBinding ?? null
          })
        }
      } else {
        void submit(
          {
            mutationId: crypto.randomUUID(),
            kind: 'create',
            key: keyForTab(tab),
            tab: entry
          },
          tab
        )
      }
    }
    const unsubscribe = useAppStore.subscribe((state, previous) => {
      const currentTabs = Object.values(state.unifiedTabsByWorktree).flat()
      const previousIds = new Set(
        Object.values(previous.unifiedTabsByWorktree).flat().map(identityForTab)
      )
      for (const tab of currentTabs) {
        publish(tab, state)
      }
      for (const oldTab of Object.values(previous.unifiedTabsByWorktree).flat()) {
        if (
          previousIds.has(identityForTab(oldTab)) &&
          !currentTabs.some((tab) => identityForTab(tab) === identityForTab(oldTab))
        ) {
          void submit(
            {
              mutationId: crypto.randomUUID(),
              kind: 'close',
              key: keyForTab(oldTab),
              tabId: oldTab.catalogTabId ?? oldTab.id
            },
            oldTab
          )
          published.current.delete(identityForTab(oldTab))
        }
      }
    })
    const apply = (change: SharedTabCatalogChange): void => {
      const revisionKey = JSON.stringify([
        change.mutation.key.executionHostId,
        change.mutation.key.workspaceKey
      ])
      const priorRevision = appliedRevisions.current.get(revisionKey) ?? 0
      if (
        change.mutation.kind === 'create' &&
        resolvedCreates.current.has(change.mutation.mutationId)
      ) {
        appliedRevisions.current.set(revisionKey, Math.max(priorRevision, change.revision))
        return
      }
      if (change.revision <= priorRevision) {
        return
      }
      const recordCreateSuccess = (resolution: 'committed' | 'rejected'): void => {
        if (change.mutation.kind !== 'create') {
          return
        }
        resolvedCreates.current.set(change.mutation.mutationId, resolution)
        appliedRevisions.current.set(
          revisionKey,
          Math.max(appliedRevisions.current.get(revisionKey) ?? 0, change.revision)
        )
      }
      const tabId =
        change.mutation.kind === 'create' ? change.mutation.tab.tabId : change.mutation.tabId
      if (change.mutation.kind === 'create' && change.tab) {
        const exact = useAppStore
          .getState()
          .unifiedTabsByWorktree[change.mutation.key.workspaceKey]?.find(
            (candidate) =>
              (candidate.catalogTabId ?? candidate.id) === (change.tab!.catalogTabId ?? tabId) &&
              (candidate.executionHostId ?? 'local') === change.mutation.key.executionHostId
          )
        if (exact && !compatibleCreate(exact, change.tab)) {
          applyingRemote.current = true
          try {
            applyCanonicalSharedTabCatalogChange(change, useAppStore, applyingRemote)
            recordCreateSuccess('rejected')
          } finally {
            applyingRemote.current = false
          }
          return
        }
        if (exact) {
          applyingRemote.current = true
          try {
            applyCanonicalSharedTabCatalogChange(change, useAppStore, applyingRemote)
            recordCreateSuccess('committed')
            return
          } finally {
            applyingRemote.current = false
          }
        }
      }
      const identity = compositeTabId(change.mutation.key, tabId)
      if (change.tab) {
        published.current.set(identity, change.tab)
      } else {
        published.current.delete(identity)
      }
      applyCanonicalSharedTabCatalogChange(change, useAppStore, applyingRemote)
      recordCreateSuccess(change.tab ? 'committed' : 'rejected')
      if (change.mutation.kind !== 'create') {
        appliedRevisions.current.set(
          revisionKey,
          Math.max(appliedRevisions.current.get(revisionKey) ?? 0, change.revision)
        )
      }
    }
    const removeListener = window.api.app.tabs.onCatalogChanged((change) => {
      if (!acceptingEvents) {
        queuedEvents.push(change)
        return
      }
      apply(change)
    })
    const hydrate = async (): Promise<void> => {
      if (!useAppStore.getState().hydrationSucceeded) {
        await new Promise<void>((resolve) => {
          const stop = useAppStore.subscribe((state) => {
            if (state.hydrationSucceeded) {
              stop()
              resolve()
            }
          })
        })
      }
      for (const tab of Object.values(useAppStore.getState().unifiedTabsByWorktree).flat()) {
        const key = keyForTab(tab)
        migrateSyncedTabIdentity(
          useAppStore,
          {
            executionHostId: key.executionHostId,
            workspaceKey: key.workspaceKey,
            catalogTabId: tab.catalogTabId ?? tab.id,
            catalogEntityId: tab.catalogEntityId ?? tab.entityId,
            onCollision: () => undefined
          },
          tab.id
        )
      }
      const partitions = await window.api.app.tabs.catalogBootstrapAll()
      for (const partition of partitions) {
        const revisionKey = JSON.stringify([
          partition.key.executionHostId,
          partition.key.workspaceKey
        ])
        appliedRevisions.current.set(
          revisionKey,
          Math.max(appliedRevisions.current.get(revisionKey) ?? 0, partition.revision)
        )
        if (disposed) {
          return
        }
        for (const sharedTab of partition.tabs) {
          const existing = useAppStore
            .getState()
            .unifiedTabsByWorktree[partition.key.workspaceKey]?.find(
              (candidate) =>
                compositeTabId(
                  {
                    executionHostId: candidate.executionHostId ?? 'local',
                    workspaceKey: candidate.worktreeId
                  },
                  candidate.catalogTabId ?? candidate.id
                ) === compositeTabId(partition.key, sharedTab.catalogTabId ?? sharedTab.tabId)
            )
          if (existing) {
            applyCanonicalSharedTabCatalogChange(
              {
                revision: 0,
                mutation: {
                  mutationId: `bootstrap:${partition.key.workspaceKey}:${sharedTab.tabId}`,
                  kind: 'patch',
                  key: partition.key,
                  tabId: sharedTab.catalogTabId ?? sharedTab.tabId,
                  metadata: sharedTab.metadata,
                  backingState: sharedTab.backingState
                },
                tab: sharedTab
              },
              useAppStore,
              applyingRemote
            )
            continue
          }
          applyingRemote.current = true
          try {
            const groupId = useAppStore
              .getState()
              .ensureWorktreeRootGroup(partition.key.workspaceKey)
            useAppStore
              .getState()
              .createUnifiedTab(
                partition.key.workspaceKey,
                sharedTab.contentType as Tab['contentType'],
                {
                  label:
                    typeof sharedTab.metadata.label === 'string'
                      ? sharedTab.metadata.label
                      : undefined,
                  customLabel:
                    typeof sharedTab.metadata.customLabel === 'string'
                      ? sharedTab.metadata.customLabel
                      : null,
                  color:
                    typeof sharedTab.metadata.color === 'string' ? sharedTab.metadata.color : null,
                  entityId: makeSyncedTabIdentity(
                    {
                      ...partition.key,
                      catalogTabId:
                        sharedTab.metadata.catalogEntityId ?? sharedTab.metadata.entityId
                    },
                    'entity'
                  ),
                  catalogEntityId:
                    sharedTab.metadata.catalogEntityId ?? sharedTab.metadata.entityId,
                  executionHostId: partition.key.executionHostId,
                  catalogTabId: sharedTab.catalogTabId ?? sharedTab.tabId,
                  id: makeSyncedTabIdentity(
                    { ...partition.key, catalogTabId: sharedTab.catalogTabId ?? sharedTab.tabId },
                    'tab'
                  ),
                  targetGroupId: groupId,
                  activate: false,
                  recordInteraction: false
                }
              )
          } finally {
            applyingRemote.current = false
          }
        }
      }
      for (const tab of Object.values(useAppStore.getState().unifiedTabsByWorktree).flat()) {
        const bootstrap = await window.api.app.tabs.catalogBootstrap(keyForTab(tab))
        if (disposed || !bootstrap) {
          continue
        }
        const shared = bootstrap.tabs.find(
          (candidate) =>
            (candidate.catalogTabId ?? candidate.tabId) === (tab.catalogTabId ?? tab.id)
        )
        if (!shared) {
          publish(tab)
        } else {
          published.current.set(identityForTab(tab), shared)
        }
      }
      queuedEvents.sort((left, right) => left.revision - right.revision)
      acceptingEvents = true
      for (const queued of queuedEvents.splice(0)) {
        if (!disposed) {
          apply(queued)
        }
      }
      bootstrapped.current = true
      for (const tab of Object.values(useAppStore.getState().unifiedTabsByWorktree).flat()) {
        if (disposed) {
          return
        }
        const bootstrap = await window.api.app.tabs.catalogBootstrap(keyForTab(tab))
        if (
          !bootstrap?.tabs.some(
            (candidate) =>
              (candidate.catalogTabId ?? candidate.tabId) === (tab.catalogTabId ?? tab.id)
          )
        ) {
          publish(tab)
        } else {
          published.current.set(
            identityForTab(tab),
            bootstrap.tabs.find(
              (candidate) =>
                (candidate.catalogTabId ?? candidate.tabId) === (tab.catalogTabId ?? tab.id)
            )!
          )
        }
      }
    }
    void hydrate()
    return () => {
      disposed = true
      unsubscribe()
      removeListener()
    }
  }, [])
}
