import type { ExecutionHostId } from './execution-host'

export type SharedTabCatalogKey = { executionHostId: ExecutionHostId; workspaceKey: string }
export type SharedTabContentType =
  | 'terminal'
  | 'editor'
  | 'diff'
  | 'conflict-review'
  | 'check-details'
  | 'browser'
  | 'simulator'
export type SharedTabCatalogMetadata = {
  entityId: string
  /** Opaque catalog identity; entityId remains renderer-local backing identity. */
  catalogEntityId?: string
  label: string
  customLabel: string | null
  color: string | null
  isPinned?: boolean
  isPreview?: boolean
  viewMode?: 'terminal' | 'chat'
}
export type SharedTabBackingState =
  | { kind: 'terminal'; ptyIds: string[] }
  | { kind: 'editor'; filePath?: string; language?: string }
  | {
      kind: 'browser'
      browserWorkspaceId?: string
      catalogEntityId?: string
      pages?: string[]
      catalogPageIds?: string[]
    }
  | { kind: 'simulator'; simulatorId?: string }
export type SharedTabCatalogEntry = {
  tabId: string
  catalogTabId?: string
  contentType: SharedTabContentType
  metadata: SharedTabCatalogMetadata
  backingState?: SharedTabBackingState
  terminalBinding?: { ptyId: string; incarnationId?: string } | null
}
export type SharedTabMutation =
  | { mutationId: string; kind: 'create'; key: SharedTabCatalogKey; tab: SharedTabCatalogEntry }
  | {
      mutationId: string
      kind: 'patch'
      key: SharedTabCatalogKey
      tabId: string
      metadata?: Partial<SharedTabCatalogMetadata>
      backingState?: SharedTabBackingState
    }
  | {
      mutationId: string
      kind: 'bind-terminal'
      key: SharedTabCatalogKey
      tabId: string
      terminalBinding: { ptyId: string; incarnationId?: string } | null
    }
  | { mutationId: string; kind: 'close'; key: SharedTabCatalogKey; tabId: string }
export type SharedTabCatalogChange = {
  revision: number
  mutation: SharedTabMutation
  tab: SharedTabCatalogEntry | null
}
export type SharedTabCatalogBootstrap = {
  revision: number
  tabs: SharedTabCatalogEntry[]
  tombstones: string[]
}
export type SharedTabCatalogPartition = SharedTabCatalogBootstrap & { key: SharedTabCatalogKey }
export type SharedTabCatalogPersistedState = {
  partitions: Record<string, SharedTabCatalogBootstrap>
}
