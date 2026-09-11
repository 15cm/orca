import { parseWorkspaceKey } from '../../shared/workspace-scope'
import { parseRuntimeWorktreeId } from './runtime-worktree-path-identity'
import {
  computeWindowOwnershipPrioritySeed,
  diffPtyOwnerWindows,
  type PtyOwnerWindowChange
} from './window-pty-ownership-priority'

type Publication = { tabIds: Set<string>; leafKeys: Set<string>; browserPageIds: Set<string> }

export function assertUniqueRuntimeGraphTabIds(tabs: readonly { tabId: string }[]): void {
  const seen = new Set<string>()
  for (const tab of tabs) {
    if (seen.has(tab.tabId)) {
      throw new Error('duplicate_runtime_tab_id')
    }
    seen.add(tab.tabId)
  }
}

export function rebuildRuntimeWindowOwnershipIndex(args: {
  publications: ReadonlyMap<number, Publication>
  explicitClaims: ReadonlyMap<string, number>
  transientClaims: ReadonlyMap<string, number>
  suppressedPtyIds?: ReadonlySet<string>
  previousPtyOwners: ReadonlyMap<string, number>
  tabs: ReadonlyMap<string, { worktreeId: string }>
  leaves: ReadonlyMap<string, { ptyId: string | null; worktreeId: string }>
  store: {
    getRepo?: (id: string) => { projectGroupId?: string | null } | undefined
    getFolderWorkspaces?: () => readonly { id: string; projectGroupId: string }[]
  } | null
  resolveWindowProjectGroupId: (windowId: number) => string | null
  onChanges?: (changes: PtyOwnerWindowChange[]) => void
}): {
  tabOwners: Map<string, number>
  tabOwnersByWorktree: Map<string, number>
  leafOwners: Map<string, number>
  ptyOwners: Map<string, number>
  browserPageOwners: Map<string, number>
  /** Transient spawn claims replaced by ownership from a published graph. */
  consumedTransientPtyIds: Set<string>
} {
  const resolveWorktreeGroup = (id: string): string | null => {
    const parsed = parseRuntimeWorktreeId(id)
    const repo = parsed?.repoId ? args.store?.getRepo?.(parsed.repoId) : undefined
    if (repo?.projectGroupId) {
      return repo.projectGroupId
    }
    const scope = parseWorkspaceKey(id)
    if (scope?.type === 'folder') {
      return (
        args.store?.getFolderWorkspaces?.().find((item) => item.id === scope.folderWorkspaceId)
          ?.projectGroupId ?? null
      )
    }
    return null
  }
  const seed = computeWindowOwnershipPrioritySeed({
    publications: args.publications,
    explicitPtyClaims: args.explicitClaims,
    resolveWindowProjectGroupId: args.resolveWindowProjectGroupId,
    resolveWorktreeProjectGroupId: resolveWorktreeGroup,
    getTabWorktreeId: (id) => args.tabs.get(id)?.worktreeId,
    getLeaf: (key) => args.leaves.get(key)
  })
  const tabOwners = new Map(seed.tabOwners)
  const leafOwners = new Map(seed.leafOwners)
  const ptyOwners = new Map(seed.ptyOwners)
  for (const ptyId of args.suppressedPtyIds ?? []) {
    ptyOwners.delete(ptyId)
  }
  const tabOwnersByWorktree = new Map<string, number>()
  const browserPageOwners = new Map<string, number>()
  const publishedPtyIds = new Set<string>()
  for (const [windowId, publication] of args.publications) {
    for (const tabId of publication.tabIds) {
      if (!tabOwners.has(tabId)) {
        tabOwners.set(tabId, windowId)
      }
      const tab = args.tabs.get(tabId)
      if (tab) {
        tabOwnersByWorktree.set(`${tab.worktreeId}\0${tabId}`, tabOwners.get(tabId)!)
      }
    }
    for (const key of publication.leafKeys) {
      if (!leafOwners.has(key)) {
        leafOwners.set(key, windowId)
      }
      const ptyId = args.leaves.get(key)?.ptyId
      if (ptyId) {
        publishedPtyIds.add(ptyId)
      }
      if (ptyId && !args.suppressedPtyIds?.has(ptyId) && !ptyOwners.has(ptyId)) {
        ptyOwners.set(ptyId, windowId)
      }
    }
    for (const pageId of publication.browserPageIds) {
      if (!browserPageOwners.has(pageId)) {
        browserPageOwners.set(pageId, windowId)
      }
    }
  }
  for (const [ptyId, owner] of args.transientClaims) {
    if (!args.suppressedPtyIds?.has(ptyId) && !ptyOwners.has(ptyId)) {
      ptyOwners.set(ptyId, owner)
    }
  }
  for (const [ptyId, owner] of args.explicitClaims) {
    if (args.suppressedPtyIds?.has(ptyId)) {
      continue
    }
    const publication = args.publications.get(owner)
    if (
      publication &&
      [...publication.leafKeys].some((key) => args.leaves.get(key)?.ptyId === ptyId)
    ) {
      ptyOwners.set(ptyId, owner)
    }
  }
  const changes = diffPtyOwnerWindows(args.previousPtyOwners, ptyOwners)
  if (changes.length) {
    args.onChanges?.(changes)
  }
  const consumedTransientPtyIds = new Set<string>()
  for (const ptyId of args.transientClaims.keys()) {
    if (publishedPtyIds.has(ptyId) && ptyOwners.has(ptyId)) {
      consumedTransientPtyIds.add(ptyId)
    }
  }
  return {
    tabOwners,
    tabOwnersByWorktree,
    leafOwners,
    ptyOwners,
    browserPageOwners,
    consumedTransientPtyIds
  }
}
