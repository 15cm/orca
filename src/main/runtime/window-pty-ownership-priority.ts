/**
 * Which window a published tab / leaf / PTY belongs to when several windows publish the same
 * graph. Three tiers, highest first:
 *
 * 1. an explicit claim ("bring here" on a mirrored pane);
 * 2. the window bound to the project group the entry's worktree belongs to;
 * 3. arrival order — the first window that published it (the caller's existing loop).
 *
 * This module computes tiers 1 and 2 as seed maps; the caller's arrival-order pass only fills
 * what is still unset. Tiers 1 and 2 never conflict with each other by construction: a claim
 * is stamped first, and scopes are singletons per project group while a worktree belongs to
 * exactly one group. A window can only win entries it actually publishes.
 */

export type PublishedWindowGraph = {
  tabIds: ReadonlySet<string>
  leafKeys: ReadonlySet<string>
}

export type PublishedLeaf = {
  ptyId: string | null
  worktreeId: string
}

export type WindowOwnershipPriorityInput = {
  /** Insertion order is arrival order; iterated in that order for determinism. */
  publications: ReadonlyMap<number, PublishedWindowGraph>
  /** ptyId → window that explicitly claimed it. */
  explicitPtyClaims: ReadonlyMap<string, number>
  /** The project group a window is bound to; null for a free window (and always while the flag is off). */
  resolveWindowProjectGroupId: (windowId: number) => string | null
  /** null when the worktree cannot be placed in a group — such entries fall through to arrival order. */
  resolveWorktreeProjectGroupId: (worktreeId: string) => string | null
  getTabWorktreeId: (tabId: string) => string | undefined
  getLeaf: (leafKey: string) => PublishedLeaf | undefined
}

export type WindowOwnershipPrioritySeed = {
  tabOwners: Map<string, number>
  leafOwners: Map<string, number>
  ptyOwners: Map<string, number>
}

export function windowPublishesPty(
  publication: PublishedWindowGraph,
  ptyId: string,
  getLeaf: WindowOwnershipPriorityInput['getLeaf']
): boolean {
  for (const leafKey of publication.leafKeys) {
    if (getLeaf(leafKey)?.ptyId === ptyId) {
      return true
    }
  }
  return false
}

export function computeWindowOwnershipPrioritySeed(
  input: WindowOwnershipPriorityInput
): WindowOwnershipPrioritySeed {
  const seed: WindowOwnershipPrioritySeed = {
    tabOwners: new Map(),
    leafOwners: new Map(),
    ptyOwners: new Map()
  }
  // Tier 1: explicit claims. A claim whose window no longer publishes the PTY is inert (not
  // dropped: a renderer reload republishes shortly), so the PTY resolves normally meanwhile.
  for (const [ptyId, windowId] of input.explicitPtyClaims) {
    const publication = input.publications.get(windowId)
    if (publication && windowPublishesPty(publication, ptyId, input.getLeaf)) {
      seed.ptyOwners.set(ptyId, windowId)
    }
  }
  // Tier 2: project scope.
  const worktreeGroupCache = new Map<string, string | null>()
  const worktreeGroup = (worktreeId: string): string | null => {
    const cached = worktreeGroupCache.get(worktreeId)
    if (cached !== undefined) {
      return cached
    }
    const resolved = input.resolveWorktreeProjectGroupId(worktreeId)
    worktreeGroupCache.set(worktreeId, resolved)
    return resolved
  }
  for (const [windowId, publication] of input.publications) {
    const windowGroupId = input.resolveWindowProjectGroupId(windowId)
    if (windowGroupId === null) {
      continue
    }
    for (const tabId of publication.tabIds) {
      const worktreeId = input.getTabWorktreeId(tabId)
      if (worktreeId !== undefined && worktreeGroup(worktreeId) === windowGroupId) {
        seed.tabOwners.set(tabId, windowId)
      }
    }
    for (const leafKey of publication.leafKeys) {
      const leaf = input.getLeaf(leafKey)
      if (!leaf || worktreeGroup(leaf.worktreeId) !== windowGroupId) {
        continue
      }
      seed.leafOwners.set(leafKey, windowId)
      if (leaf.ptyId && !seed.ptyOwners.has(leaf.ptyId)) {
        seed.ptyOwners.set(leaf.ptyId, windowId)
      }
    }
  }
  return seed
}

export type PtyOwnerWindowChange = {
  ptyId: string
  previousWindowId: number | null
  nextWindowId: number | null
}

export function diffPtyOwnerWindows(
  previous: ReadonlyMap<string, number>,
  next: ReadonlyMap<string, number>
): PtyOwnerWindowChange[] {
  const changes: PtyOwnerWindowChange[] = []
  for (const [ptyId, nextWindowId] of next) {
    const previousWindowId = previous.get(ptyId) ?? null
    if (previousWindowId !== nextWindowId) {
      changes.push({ ptyId, previousWindowId, nextWindowId })
    }
  }
  for (const [ptyId, previousWindowId] of previous) {
    if (!next.has(ptyId)) {
      changes.push({ ptyId, previousWindowId, nextWindowId: null })
    }
  }
  return changes
}
