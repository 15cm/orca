/* eslint-disable unicorn/no-useless-spread */
// @ts-nocheck -- mechanically split from OrcaRuntimeService; behavior is covered by AST equivalence and characterization tests.
import { OrcaRuntimeWithAttachWindow } from './orca-runtime-attach-window'
import type {
  RuntimeRendererSyncWindowGraph,
  RuntimeSyncWindowGraph,
  RuntimeSyncWindowGraphResult
} from '../../shared/runtime-types'
import { HEADLESS_RUNTIME_WINDOW_ID } from '../../shared/runtime-types'
import { reconcileRuntimeGraphLeaves } from './runtime-graph-leaf-reconciliation'
import {
  assertUniqueRuntimeGraphTabIds,
  rebuildRuntimeWindowOwnershipIndex
} from './runtime-window-ownership-index'

export class OrcaRuntimeWithSyncWindowGraph extends OrcaRuntimeWithAttachWindow {
  shouldRelayTerminalBrowserOpens(): boolean {
    return this.authoritativeWindowId === HEADLESS_RUNTIME_WINDOW_ID
  }

  syncWindowGraph(
    windowId: number,
    graph: RuntimeSyncWindowGraph | RuntimeRendererSyncWindowGraph
  ): RuntimeSyncWindowGraphResult {
    // `tabs` and several downstream indexes are keyed only by tab id. Reject
    // malformed persisted/mirrored graphs before authority or graph state is
    // changed; choosing a winner would route PTYs to the wrong worktree.
    assertUniqueRuntimeGraphTabIds(graph.tabs)
    if (
      windowId !== HEADLESS_RUNTIME_WINDOW_ID &&
      this.authoritativeWindowId === HEADLESS_RUNTIME_WINDOW_ID &&
      this.headlessGraphFallbackAvailable
    ) {
      if (windowId !== this.pendingHeadlessPromotionWindowId) {
        throw new Error('Runtime graph publisher does not match the pending desktop promotion')
      }
      // Why: a renderer may publish after a failed promotion was restored to
      // headless authority; accepting that late healthy graph is self-healing.
      this.attachWindow(windowId)
    }
    if (this.authoritativeWindowId === null) {
      this.authoritativeWindowId = windowId
    }
    // Only attached windows may publish; authoritativeWindowId owns reload/headless lifecycle.
    const isAuthoritativePublisher = windowId === this.authoritativeWindowId
    if (!isAuthoritativePublisher && !this.windowGraphPublications.has(windowId)) {
      throw new Error('Runtime graph publisher does not match the authoritative window')
    }
    const rendererGeneration =
      windowId === HEADLESS_RUNTIME_WINDOW_ID || !isAuthoritativePublisher
        ? null
        : 'rendererGeneration' in graph && typeof graph.rendererGeneration === 'string'
          ? graph.rendererGeneration
          : undefined
    if (
      typeof rendererGeneration === 'string' &&
      rendererGeneration === this.rendererGeneration &&
      this.graphStatus !== 'ready'
    ) {
      throw new Error('Runtime graph publisher belongs to a superseded renderer generation')
    }
    if (windowId === HEADLESS_RUNTIME_WINDOW_ID) {
      this.headlessGraphFallbackAvailable = true
      this.rendererGeneration = null
    }

    const previousPublication = this.windowGraphPublications.get(windowId)
    this.windowGraphPublications.set(windowId, {
      tabIds: new Set(graph.tabs.map((tab) => tab.tabId)),
      leafKeys: new Set(graph.leaves.map((leaf) => this.getLeafKey(leaf.tabId, leaf.leafId))),
      browserPageIds: new Set(
        graph.mobileSessionTabs === undefined
          ? (previousPublication?.browserPageIds ?? new Set())
          : (graph.mobileSessionTabs ?? []).flatMap((snapshot) =>
              snapshot.tabs.flatMap((tab) =>
                tab.type === 'browser' && tab.browserPageId ? [tab.browserPageId] : []
              )
            )
      )
    })
    // Preserve panes still published by another window.
    if ([...this.windowGraphPublications.keys()].some((id) => id !== windowId)) {
      const survivingTabs = new Set<string>()
      const survivingLeaves = new Set<string>()
      for (const [id, publication] of this.windowGraphPublications) {
        if (id === windowId) {
          continue
        }
        publication.tabIds.forEach((tabId) => survivingTabs.add(tabId))
        publication.leafKeys.forEach((key) => survivingLeaves.add(key))
      }
      const allTabs = new Map([...this.tabs].filter(([id]) => survivingTabs.has(id)))
      for (const tab of graph.tabs) {
        allTabs.set(tab.tabId, tab)
      }
      const allLeaves = new Map([...this.leaves].filter(([key]) => survivingLeaves.has(key)))
      for (const leaf of graph.leaves) {
        allLeaves.set(this.getLeafKey(leaf.tabId, leaf.leafId), leaf)
      }
      graph = { ...graph, tabs: [...allTabs.values()], leaves: [...allLeaves.values()] }
    }

    const graphWasReady = this.graphStatus === 'ready'
    const previousTabs = this.tabs
    const previousLeaves = this.leaves
    this.tabs = new Map(graph.tabs.map((tab) => [tab.tabId, tab]))
    const lifecycleLeaves = this.reconcileMobileSessionRetirementFences(graph.leaves)
    const mobileSessionResyncWorktrees = new Set<string>()
    const changedMobileWorktrees = this.syncMobileSessionTabs(
      graph.mobileSessionTabs,
      graph.unchangedMobileSessionWorktrees,
      mobileSessionResyncWorktrees,
      rendererGeneration
    )
    const graphSyncedAt = this.nextTitleObservationSequence()
    const preserveLivePtysDuringReload = this.graphStatus === 'reloading'
    const nextLeaves = reconcileRuntimeGraphLeaves(
      this,
      lifecycleLeaves,
      graphSyncedAt,
      preserveLivePtysDuringReload
    )
    this.leaves = nextLeaves
    this.rebuildLeafPtyIndex()
    this.rebuildOwnerWindowIndexes()
    this.reconcilePtyIncarnationHandles()
    // Why: the emitted client payload is a function of the stored snapshot AND
    // the tab/leaf graph (handles/titles/connected resolve from leaf state), so
    // a graph-only change — e.g. a restored leaf binding its ptyId while the
    // snapshot pair is unchanged — must also fan out, or a paired client stays
    // on pending-handle forever. Schedule the union on the same 50ms trailing
    // edge as the OSC-title path; the coalescer emit reads the latest state at
    // fire time so no final version is ever lost.
    for (const worktreeId of this.collectMobileVisibleGraphChangedWorktrees(
      previousTabs,
      previousLeaves
    )) {
      if (changedMobileWorktrees.has(worktreeId)) {
        continue
      }
      const stored = this.mobileSessionTabsByWorktree.get(worktreeId)
      if (!stored) {
        continue
      }
      // Graph-only changes need a fresh version so paired clients accept the re-emission.
      this.storeMobileSessionSnapshot(worktreeId, {
        ...stored,
        snapshotVersion: stored.snapshotVersion + 1
      })
      changedMobileWorktrees.add(worktreeId)
    }
    for (const worktreeId of changedMobileWorktrees) {
      if (this.mobileSessionTabsByWorktree.has(worktreeId)) {
        this.scheduleMobileSessionTabsChanged(worktreeId)
      }
    }
    const isAuthoritativeGraphPublisher = windowId === this.authoritativeWindowId
    this.markGraphReady(windowId)
    if (
      isAuthoritativeGraphPublisher &&
      (windowId === HEADLESS_RUNTIME_WINDOW_ID || graph.mobileSessionTabs !== undefined)
    ) {
      if (mobileSessionResyncWorktrees.size === 0) {
        this.markSessionTabsInventoryPublished()
      } else {
        this.sessionTabsInventoryPublicationEpoch = null
      }
    }
    if (rendererGeneration !== undefined) {
      this.rendererGeneration = rendererGeneration
    }
    for (const leaf of this.leaves.values()) {
      this.adoptPreAllocatedHandle(leaf)
      const previousLeaf = previousLeaves.get(this.getLeafKey(leaf.tabId, leaf.leafId))
      if (
        this._orchestrationDb &&
        leaf.lastAgentStatus === 'idle' &&
        leaf.lastAgentStatusObservedLive &&
        leaf.writable &&
        (!graphWasReady ||
          previousLeaf?.ptyId !== leaf.ptyId ||
          !previousLeaf.writable ||
          previousLeaf.lastAgentStatus !== 'idle' ||
          !previousLeaf.lastAgentStatusObservedLive)
      ) {
        this.deliverPendingMessagesForLeaf(leaf)
      }
    }

    // Why: createTerminal waits for the renderer's graph sync to populate the
    // new leaf so it can return a handle. Drain callbacks after leaves update.
    for (const cb of [...this.graphSyncCallbacks]) {
      cb()
    }

    const agentOrchestrationByPaneKey = this.agentOrchestrationProjection.buildByPaneKey()
    const nativeChatLaunchDraftResolutions =
      this.getNativeChatLaunchDraftResolutionClientEventSnapshot().map(
        ({ tabId, text, createdAt }) => ({ tabId, text, createdAt })
      )
    return {
      ...this.getStatus(),
      ...(agentOrchestrationByPaneKey ? { agentOrchestrationByPaneKey } : {}),
      ...(nativeChatLaunchDraftResolutions.length > 0 ? { nativeChatLaunchDraftResolutions } : {}),
      ...(mobileSessionResyncWorktrees.size > 0
        ? { mobileSessionResyncWorktrees: [...mobileSessionResyncWorktrees] }
        : {})
    }
  }

  protected rebuildOwnerWindowIndexes(): void {
    const indexes = rebuildRuntimeWindowOwnershipIndex({
      publications: this.windowGraphPublications,
      explicitClaims: this.explicitPtyOwnerWindowById,
      transientClaims: this.transientPtyOwnerWindowById,
      suppressedPtyIds: this.suppressedPtyOwnerWindowIds,
      previousPtyOwners: this.ptyOwnerWindowById,
      tabs: this.tabs,
      leaves: this.leaves,
      store: this.store,
      resolveWindowProjectGroupId: this.resolveWindowProjectGroupIdFn ?? (() => null)
    })
    for (const ptyId of indexes.consumedTransientPtyIds) {
      this.transientPtyOwnerWindowById.delete(ptyId)
    }
    this.tabOwnerWindowById = indexes.tabOwners
    this.tabOwnerWindowByWorktreeAndTabId = indexes.tabOwnersByWorktree
    this.leafOwnerWindowByKey = indexes.leafOwners
    this.ptyOwnerWindowById = indexes.ptyOwners
    this.browserPageOwnerWindowById = indexes.browserPageOwners
    // Restore routing resolves through these indexes, so publish only after they are current.
    if (indexes.ptyOwnerChanges.length > 0) {
      this.onPtyOwnerWindowsChanged?.(indexes.ptyOwnerChanges)
    }
  }
}
