import { ipcMain } from 'electron'
import { broadcastToMainWindows, getMainWindowForWebContents } from './main-window-registry'
import type { Store } from '../persistence'
import type { ExecutionHostId } from '../../shared/execution-host'
import type {
  SharedTabCatalogBootstrap,
  SharedTabCatalogChange,
  SharedTabCatalogEntry,
  SharedTabCatalogKey,
  SharedTabMutation,
  SharedTabCatalogPersistedState,
  SharedTabCatalogPartition
} from '../../shared/shared-tab-catalog-types'
import { isCatalogChange, isMutationContentCompatible } from './shared-tab-catalog-validation'
export type {
  SharedTabCatalogBootstrap,
  SharedTabCatalogChange,
  SharedTabCatalogEntry,
  SharedTabCatalogKey,
  SharedTabMutation
} from '../../shared/shared-tab-catalog-types'
type CatalogPartition = {
  revision: number
  tabs: Map<string, SharedTabCatalogEntry>
  tombstones: Set<string>
  mutations: Map<string, SharedTabCatalogChange>
}
function partitionId(key: SharedTabCatalogKey): string {
  return JSON.stringify([key.executionHostId, key.workspaceKey])
}
function tabIdForMutation(mutation: SharedTabMutation): string {
  return mutation.kind === 'create' ? mutation.tab.tabId : mutation.tabId
}
function cloneTab(tab: SharedTabCatalogEntry): SharedTabCatalogEntry {
  return {
    ...tab,
    metadata: { ...tab.metadata },
    ...(tab.backingState ? { backingState: { ...tab.backingState } } : {}),
    ...(tab.terminalBinding ? { terminalBinding: { ...tab.terminalBinding } } : {})
  }
}
const CATALOG_CONTENT_TYPES = new Set([
    'terminal',
    'editor',
    'diff',
    'conflict-review',
    'check-details',
    'browser',
    'simulator'
  ]),
  MAX_CATALOG_SERIALIZED_SIZE = 512_000,
  MAX_CATALOG_PARTITIONS = 256,
  MAX_CATALOG_TABS = 512,
  MAX_CATALOG_TOMBSTONES = 1024
export class SharedTabCatalog {
  private readonly partitions = new Map<string, CatalogPartition>()
  bootstrap(key: SharedTabCatalogKey): SharedTabCatalogBootstrap {
    const partition = this.getPartition(key)
    return {
      revision: partition.revision,
      tabs: [...partition.tabs.values()].map(cloneTab),
      tombstones: [...partition.tombstones]
    }
  }
  bootstrapAll(): SharedTabCatalogPartition[] {
    const result: SharedTabCatalogPartition[] = []
    for (const [id] of this.partitions) {
      try {
        const [executionHostId, workspaceKey] = JSON.parse(id) as [unknown, unknown]
        if (typeof executionHostId === 'string' && typeof workspaceKey === 'string') {
          result.push({
            key: { executionHostId: executionHostId as ExecutionHostId, workspaceKey },
            ...this.bootstrap({ executionHostId: executionHostId as ExecutionHostId, workspaceKey })
          })
        }
      } catch {
        // Ignore malformed persisted keys.
      }
    }
    return result
  }
  submit(mutation: SharedTabMutation): SharedTabCatalogChange {
    const partition = this.getPartition(mutation.key)
    const prior = partition.mutations.get(mutation.mutationId)
    if (prior) {
      return this.cloneChange(prior)
    }
    const tabId = tabIdForMutation(mutation)
    const current = partition.tabs.get(tabId)
    let tab: SharedTabCatalogEntry | null = current ? cloneTab(current) : null
    if (mutation.kind === 'create') {
      if (partition.tombstones.has(tabId)) {
        tab = null
      } else if (!current) {
        tab = cloneTab(mutation.tab)
        partition.tabs.set(tabId, tab)
      }
    } else if (mutation.kind === 'close') {
      if (current) {
        partition.tabs.delete(tabId)
      }
      partition.tombstones.add(tabId)
      tab = null
    } else if (current && !partition.tombstones.has(tabId)) {
      tab =
        mutation.kind === 'patch'
          ? {
              ...current,
              ...(mutation.metadata && { metadata: { ...current.metadata, ...mutation.metadata } }),
              ...(mutation.backingState && { backingState: mutation.backingState })
            }
          : {
              ...current,
              terminalBinding: mutation.terminalBinding ? { ...mutation.terminalBinding } : null
            }
      partition.tabs.set(tabId, tab)
    }
    const change: SharedTabCatalogChange = {
      revision: ++partition.revision,
      mutation,
      tab: tab ? cloneTab(tab) : null
    }
    partition.mutations.set(mutation.mutationId, change)
    return this.cloneChange(change)
  }
  hasTab(key: SharedTabCatalogKey, tabId: string): boolean {
    return this.getPartition(key).tabs.has(tabId)
  }
  exportState(executionHostId?: string): SharedTabCatalogPersistedState {
    const partitions: Record<string, SharedTabCatalogBootstrap> = {}
    for (const [id, partition] of this.partitions) {
      if (executionHostId) {
        let partitionHost: unknown
        try {
          partitionHost = JSON.parse(id)[0]
        } catch {
          continue
        }
        if (partitionHost !== executionHostId) {
          continue
        }
      }
      partitions[id] = {
        revision: partition.revision,
        tabs: [...partition.tabs.values()].map(cloneTab),
        tombstones: [...partition.tombstones]
      }
    }
    return { partitions }
  }
  importState(state: SharedTabCatalogPersistedState | undefined): void {
    if (
      !state ||
      !isBoundedCatalogValue(state) ||
      Object.keys(state.partitions).length > MAX_CATALOG_PARTITIONS
    ) {
      return
    }
    for (const [id, saved] of Object.entries(state?.partitions ?? {})) {
      if (
        !saved ||
        !Number.isSafeInteger(saved.revision) ||
        saved.revision < 0 ||
        !Array.isArray(saved.tabs) ||
        !Array.isArray(saved.tombstones) ||
        saved.tabs.length > MAX_CATALOG_TABS ||
        saved.tombstones.length > MAX_CATALOG_TOMBSTONES ||
        saved.tabs.some((tab) => !isCatalogEntry(tab)) ||
        saved.tombstones.some(
          (tabId) => typeof tabId !== 'string' || tabId.length === 0 || tabId.length > 512
        )
      ) {
        continue
      }
      const partition: CatalogPartition = {
        revision: saved.revision,
        tabs: new Map(saved.tabs.map((tab) => [tab.tabId, cloneTab(tab)])),
        tombstones: new Set(saved.tombstones),
        mutations: new Map()
      }
      if (
        partition.tabs.size > MAX_CATALOG_TABS ||
        partition.tombstones.size > MAX_CATALOG_TOMBSTONES
      ) {
        continue
      }
      for (const tabId of partition.tombstones) {
        partition.tabs.delete(tabId)
      }
      const current = this.partitions.get(id)
      if (!current || saved.revision > current.revision) {
        this.partitions.set(id, partition)
      }
    }
  }
  private getPartition(key: SharedTabCatalogKey): CatalogPartition {
    const id = partitionId(key)
    let partition = this.partitions.get(id)
    if (!partition) {
      partition = { revision: 0, tabs: new Map(), tombstones: new Set(), mutations: new Map() }
      this.partitions.set(id, partition)
    }
    return partition
  }
  private cloneChange(change: SharedTabCatalogChange): SharedTabCatalogChange {
    return {
      ...change,
      mutation: { ...change.mutation },
      tab: change.tab ? cloneTab(change.tab) : null
    }
  }
}
export const sharedTabCatalog = new SharedTabCatalog()
function isCatalogKey(value: unknown): value is SharedTabCatalogKey {
  if (!value || typeof value !== 'object') {
    return false
  }
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.executionHostId === 'string' &&
    candidate.executionHostId.length <= 256 &&
    typeof candidate.workspaceKey === 'string' &&
    candidate.workspaceKey.length > 0 &&
    candidate.workspaceKey.length <= 2048
  )
}
function isCatalogEntry(value: unknown): value is SharedTabCatalogEntry {
  if (!value || typeof value !== 'object') {
    return false
  }
  const candidate = value as Record<string, unknown>
  const metadata = candidate.metadata
  if (
    !Object.keys(candidate).every((key) =>
      [
        'tabId',
        'catalogTabId',
        'contentType',
        'metadata',
        'backingState',
        'terminalBinding'
      ].includes(key)
    )
  ) {
    return false
  }
  if (
    !(
      typeof candidate.tabId === 'string' &&
      candidate.tabId.length > 0 &&
      candidate.tabId.length <= 512 &&
      typeof candidate.contentType === 'string' &&
      CATALOG_CONTENT_TYPES.has(candidate.contentType) &&
      typeof metadata === 'object' &&
      metadata !== null
    )
  ) {
    return false
  }
  const fields = metadata as Record<string, unknown>
  if (
    !Object.keys(fields).every((key) =>
      [
        'entityId',
        'catalogEntityId',
        'label',
        'customLabel',
        'color',
        'isPinned',
        'isPreview',
        'viewMode'
      ].includes(key)
    )
  ) {
    return false
  }
  if (
    !(
      typeof fields.entityId === 'string' &&
      fields.entityId.length > 0 &&
      fields.entityId.length <= 4096 &&
      (fields.catalogEntityId === undefined ||
        (typeof fields.catalogEntityId === 'string' &&
          fields.catalogEntityId.length > 0 &&
          fields.catalogEntityId.length <= 4096)) &&
      typeof fields.label === 'string' &&
      fields.label.length <= 4096 &&
      (fields.customLabel === null || typeof fields.customLabel === 'string') &&
      (fields.color === null || typeof fields.color === 'string') &&
      (fields.isPinned === undefined || typeof fields.isPinned === 'boolean') &&
      (fields.isPreview === undefined || typeof fields.isPreview === 'boolean') &&
      (fields.viewMode === undefined ||
        fields.viewMode === 'terminal' ||
        fields.viewMode === 'chat')
    )
  ) {
    return false
  }
  const backing = candidate.backingState
  if (backing !== undefined) {
    if (
      !backing ||
      typeof backing !== 'object' ||
      typeof (backing as Record<string, unknown>).kind !== 'string'
    ) {
      return false
    }
    const kind = (backing as Record<string, unknown>).kind
    if (kind === 'terminal') {
      const ptyIds = (backing as Record<string, unknown>).ptyIds
      if (
        !Array.isArray(ptyIds) ||
        ptyIds.length > MAX_CATALOG_TABS ||
        ptyIds.some((id) => typeof id !== 'string' || id.length < 1 || id.length > 512)
      ) {
        return false
      }
    } else if (kind === 'editor') {
      const b = backing as Record<string, unknown>
      if (
        (b.filePath !== undefined &&
          (typeof b.filePath !== 'string' || b.filePath.length > 4096)) ||
        (b.language !== undefined && (typeof b.language !== 'string' || b.language.length > 256))
      ) {
        return false
      }
    } else if (kind === 'browser') {
      const b = backing as Record<string, unknown>
      if (
        (b.browserWorkspaceId !== undefined &&
          (typeof b.browserWorkspaceId !== 'string' || b.browserWorkspaceId.length > 4096)) ||
        (b.pages !== undefined &&
          (!Array.isArray(b.pages) ||
            b.pages.length > MAX_CATALOG_TABS ||
            b.pages.some((id) => typeof id !== 'string' || id.length > 4096)))
      ) {
        return false
      }
      if (
        b.catalogEntityId !== undefined &&
        (typeof b.catalogEntityId !== 'string' ||
          b.catalogEntityId.length === 0 ||
          b.catalogEntityId.length > 4096)
      ) {
        return false
      }
      if (
        b.catalogPageIds !== undefined &&
        (!Array.isArray(b.catalogPageIds) ||
          b.catalogPageIds.length > MAX_CATALOG_TABS ||
          b.catalogPageIds.some(
            (id) => typeof id !== 'string' || id.length === 0 || id.length > 4096
          ))
      ) {
        return false
      }
    } else if (kind === 'simulator') {
      const id = (backing as Record<string, unknown>).simulatorId
      if (id !== undefined && (typeof id !== 'string' || id.length > 4096)) {
        return false
      }
    } else {
      return false
    }
  }
  const expectedBacking =
    candidate.contentType === 'terminal'
      ? 'terminal'
      : candidate.contentType === 'browser'
        ? 'browser'
        : candidate.contentType === 'simulator'
          ? 'simulator'
          : 'editor'
  if (backing !== undefined && (backing as Record<string, unknown>).kind !== expectedBacking) {
    return false
  }
  const binding = candidate.terminalBinding
  if (binding != null && candidate.contentType !== 'terminal') {
    return false
  }
  return isCatalogBinding(binding)
}
function isCatalogMutation(value: unknown): value is SharedTabMutation {
  if (!value || typeof value !== 'object') {
    return false
  }
  const candidate = value as Record<string, unknown>
  if (
    !Object.keys(candidate).every((key) =>
      [
        'mutationId',
        'kind',
        'key',
        'tab',
        'tabId',
        'metadata',
        'backingState',
        'terminalBinding'
      ].includes(key)
    )
  ) {
    return false
  }
  if (
    typeof candidate.mutationId !== 'string' ||
    candidate.mutationId.length < 1 ||
    candidate.mutationId.length > 512 ||
    !isCatalogKey(candidate.key)
  ) {
    return false
  }
  if (candidate.kind === 'create') {
    const tab = candidate.tab
    return isCatalogEntry(tab)
  }
  if (
    (candidate.kind === 'patch' ||
      candidate.kind === 'bind-terminal' ||
      candidate.kind === 'close') &&
    typeof candidate.tabId === 'string' &&
    candidate.tabId.length > 0 &&
    candidate.tabId.length <= 512
  ) {
    if (candidate.kind === 'bind-terminal') {
      const binding = candidate.terminalBinding
      return isCatalogBinding(binding)
    }
    if (candidate.kind === 'patch') {
      return (
        (candidate.metadata === undefined || isCatalogMetadata(candidate.metadata)) &&
        (candidate.backingState === undefined || isCatalogBacking(candidate.backingState))
      )
    }
    return true
  }
  return false
}
function isCatalogMetadata(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false
  }
  const metadata = value as Record<string, unknown>
  return (
    Object.keys(metadata).every((key) =>
      [
        'entityId',
        'catalogEntityId',
        'label',
        'customLabel',
        'color',
        'isPinned',
        'isPreview',
        'viewMode'
      ].includes(key)
    ) &&
    (metadata.entityId === undefined ||
      (typeof metadata.entityId === 'string' &&
        metadata.entityId.length > 0 &&
        metadata.entityId.length <= 4096)) &&
    (metadata.catalogEntityId === undefined ||
      (typeof metadata.catalogEntityId === 'string' &&
        metadata.catalogEntityId.length > 0 &&
        metadata.catalogEntityId.length <= 4096)) &&
    (metadata.label === undefined ||
      (typeof metadata.label === 'string' && metadata.label.length <= 4096)) &&
    (metadata.customLabel === undefined ||
      metadata.customLabel === null ||
      typeof metadata.customLabel === 'string') &&
    (metadata.color === undefined ||
      metadata.color === null ||
      typeof metadata.color === 'string') &&
    (metadata.isPinned === undefined || typeof metadata.isPinned === 'boolean') &&
    (metadata.isPreview === undefined || typeof metadata.isPreview === 'boolean') &&
    (metadata.viewMode === undefined ||
      metadata.viewMode === 'terminal' ||
      metadata.viewMode === 'chat')
  )
}
function isCatalogBacking(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false
  }
  const kind = (value as Record<string, unknown>).kind
  return (
    ['terminal', 'editor', 'browser', 'simulator'].includes(typeof kind === 'string' ? kind : '') &&
    isCatalogEntry({
      tabId: 'validation',
      contentType:
        kind === 'terminal'
          ? 'terminal'
          : kind === 'browser'
            ? 'browser'
            : kind === 'simulator'
              ? 'simulator'
              : 'editor',
      metadata: { entityId: 'validation', label: '', customLabel: null, color: null },
      backingState: value
    })
  )
}
function isCatalogBinding(value: unknown): boolean {
  if (value === undefined || value === null) {
    return true
  }
  if (!value || typeof value !== 'object') {
    return false
  }
  const binding = value as Record<string, unknown>
  return (
    Object.keys(binding).every((key) => ['ptyId', 'incarnationId'].includes(key)) &&
    typeof binding.ptyId === 'string' &&
    binding.ptyId.length > 0 &&
    binding.ptyId.length <= 512 &&
    (binding.incarnationId === undefined ||
      (typeof binding.incarnationId === 'string' && binding.incarnationId.length <= 128))
  )
}
function isBoundedCatalogValue(value: unknown): boolean {
  try {
    return JSON.stringify(value).length <= MAX_CATALOG_SERIALIZED_SIZE
  } catch {
    return false
  }
}

export function registerSharedTabCatalogIpc(store?: Store): void {
  for (const hostId of store?.getWorkspaceSessionHostIds() ?? []) {
    const persisted = store?.getWorkspaceSession(hostId).sharedTabCatalog
    if (persisted) {
      sharedTabCatalog.importState(persisted)
    }
  }
  ipcMain.removeHandler('tabs:catalogBootstrap')
  ipcMain.removeHandler('tabs:catalogBootstrapAll')
  ipcMain.removeHandler('tabs:catalogMutate')
  ipcMain.handle('tabs:catalogBootstrap', (event, key: SharedTabCatalogKey) => {
    if (
      !getMainWindowForWebContents(event.sender) ||
      !isCatalogKey(key) ||
      !isBoundedCatalogValue(key)
    ) {
      return null
    }
    const persisted = store?.getWorkspaceSession(key.executionHostId).sharedTabCatalog
    if (persisted) {
      sharedTabCatalog.importState(persisted)
    }
    return sharedTabCatalog.bootstrap(key)
  })
  ipcMain.handle('tabs:catalogBootstrapAll', (event) => {
    if (!getMainWindowForWebContents(event.sender)) {
      return []
    }
    for (const hostId of store?.getWorkspaceSessionHostIds() ?? []) {
      const state = store?.getWorkspaceSession(hostId).sharedTabCatalog
      if (state) {
        sharedTabCatalog.importState(state)
      }
    }
    return sharedTabCatalog.bootstrapAll()
  })
  ipcMain.handle('tabs:catalogMutate', (event, mutation: SharedTabMutation) => {
    if (
      !getMainWindowForWebContents(event.sender) ||
      !isBoundedCatalogValue(mutation) ||
      !isCatalogMutation(mutation)
    ) {
      return null
    }
    const existing =
      sharedTabCatalog
        .bootstrap(mutation.key)
        .tabs.find((tab) => tab.tabId === tabIdForMutation(mutation)) ?? null
    if (!isMutationContentCompatible(mutation, existing)) {
      return null
    }
    const change = sharedTabCatalog.submit(mutation)
    if (store) {
      store.persistSharedTabCatalog(
        sharedTabCatalog.exportState(mutation.key.executionHostId),
        mutation.key.executionHostId
      )
    }
    if (isCatalogChange(change, isCatalogMutation, isCatalogEntry)) {
      broadcastToMainWindows('tabs:catalogChanged', change)
    }
    return change
  })
}
