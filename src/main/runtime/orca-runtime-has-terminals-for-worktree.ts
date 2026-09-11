// @ts-nocheck -- mechanically split from OrcaRuntimeService; behavior is covered by AST equivalence and characterization tests.
import { OrcaRuntimeWithStopExactTerminalsForWorktree } from './orca-runtime-stop-exact-terminals-for-worktree'
import type { RuntimeRendererReloadFence } from './orca-runtime-core'
import { HEADLESS_RUNTIME_WINDOW_ID } from '../../shared/runtime-types'

export class OrcaRuntimeWithHasTerminalsForWorktree extends OrcaRuntimeWithStopExactTerminalsForWorktree {
  async hasTerminalsForWorktree(worktreeSelector: string): Promise<boolean> {
    const graphEpoch = this.captureReadyGraphEpoch()
    const worktree = await this.resolveWorktreeSelector(worktreeSelector)
    this.assertStableReadyGraph(graphEpoch)
    for (const leaf of this.leaves.values()) {
      if (leaf.worktreeId === worktree.id && leaf.ptyId) {
        return true
      }
    }
    for (const pty of this.ptysById.values()) {
      if (pty.worktreeId === worktree.id && pty.connected) {
        return true
      }
    }
    return false
  }

  markRendererReloading(windowId: number): RuntimeRendererReloadFence | null {
    if (
      windowId !== HEADLESS_RUNTIME_WINDOW_ID &&
      this.authoritativeWindowId === HEADLESS_RUNTIME_WINDOW_ID &&
      this.headlessGraphFallbackAvailable
    ) {
      this.attachWindow(windowId)
      const revision = this.graphReloadLifecycle.getActiveRevision()
      return this.authoritativeWindowId === windowId && revision !== null
        ? { revision, recovery: 'headless' }
        : null
    }
    if (windowId !== this.authoritativeWindowId) {
      return null
    }
    if (this.graphStatus === 'reloading') {
      return {
        revision: this.graphReloadLifecycle.begin(windowId),
        recovery: this.shouldRestoreHeadlessGraph(windowId) ? 'headless' : 'reloading'
      }
    }
    if (this.graphStatus !== 'ready') {
      return null
    }
    return { revision: this.beginGraphReload(windowId), recovery: 'renderer' }
  }

  protected beginGraphReload(windowId: number): number {
    // Why: the rebuilt graph decides whether an incarnation survived; do not stale proven process identities before that comparison.
    this.rendererGraphEpoch += 1
    this.graphStatus = 'reloading'
    const revision = this.graphReloadLifecycle.begin(windowId)
    this.setTerminalSideEffectConsumerAvailable(false)
    this.rememberDetachedPreAllocatedLeaves()
    const retainedHandles = new Set([
      ...this.handleByPtyId.values(),
      ...[...this.handleByPtyIncarnation.values()].map((record) => record.handle)
    ])
    for (const handle of this.terminalWaiters.handles()) {
      if (!retainedHandles.has(handle)) {
        this.rejectWaitersForHandle(handle, 'terminal_handle_stale')
      }
    }
    this.handles.clear()
    this.handleByLeafKey.clear()
    // Why: handleByPtyId (pre-allocated CLI handles) survives reloads so CLI agents keep control; adoptPreAllocatedHandle re-links on the new graph.
    // Incarnation-scoped waiters survive a renderer reload; the rebuilt graph
    // may re-adopt the same PTY and resolve them without a false stale error.
    this.refreshWritableFlags()
    return revision
  }

  markRendererReloadCancelled(windowId: number, fence: RuntimeRendererReloadFence): boolean {
    if (
      windowId !== this.authoritativeWindowId ||
      this.graphStatus !== 'reloading' ||
      !this.graphReloadLifecycle.settle(fence.revision, 'cancelled')
    ) {
      return false
    }
    if (fence.recovery === 'headless' && this.shouldRestoreHeadlessGraph(windowId)) {
      this.restoreHeadlessGraphAuthority()
      return false
    }
    if (fence.recovery === 'renderer') {
      const restoresPublishedInventory =
        this.sessionTabsInventoryPublicationEpoch === this.rendererGraphEpoch - 1
      this.graphStatus = 'ready'
      this.setTerminalSideEffectConsumerAvailable(true)
      for (const leaf of this.leaves.values()) {
        this.adoptPreAllocatedHandle(leaf)
      }
      this.reconcilePtyIncarnationHandles()
      this.refreshWritableFlags()
      if (restoresPublishedInventory) {
        this.markSessionTabsInventoryPublished()
      }
      return true
    }
    this.graphReloadLifecycle.begin(windowId)
    return false
  }

  markGraphReady(windowId: number): void {
    if (windowId !== this.authoritativeWindowId) {
      return
    }
    this.graphReloadLifecycle.settleActive('success')
    if (windowId !== HEADLESS_RUNTIME_WINDOW_ID) {
      this.headlessGraphFallbackAvailable = false
      this.pendingHeadlessPromotionWindowId = null
    }
    this.graphStatus = 'ready'
    this.setTerminalSideEffectConsumerAvailable(windowId !== HEADLESS_RUNTIME_WINDOW_ID)
    this.refreshWritableFlags()
  }

  markGraphReloadFailed(
    windowId: number,
    _reason: 'renderer-frame-unavailable' | 'renderer-process-gone'
  ): void {
    if (windowId !== this.authoritativeWindowId) {
      return
    }
    if (this.graphStatus === 'ready') {
      this.beginGraphReload(windowId)
    }
    this.graphReloadLifecycle.settleActive('failure')
    this.transitionGraphReloadToTerminalState(windowId)
  }

  markGraphUnavailable(windowId: number): void {
    const hasContribution = this.windowGraphPublications.has(windowId)
    if (
      this.authoritativeWindowId === HEADLESS_RUNTIME_WINDOW_ID &&
      windowId === this.pendingHeadlessPromotionWindowId
    ) {
      this.pendingHeadlessPromotionWindowId = null
      if (hasContribution) {
        this.dropWindowGraphContribution(windowId)
      }
      return
    }
    if (windowId !== this.authoritativeWindowId) {
      // A secondary close retires only its own publication. The lifecycle may
      // already have called releaseWindow, so this must be idempotent.
      if (hasContribution) {
        this.dropWindowGraphContribution(windowId)
      }
      return
    }
    if (hasContribution) {
      this.dropWindowGraphContribution(windowId)
    }
    this.graphReloadLifecycle.settleActive('cancelled')
    // Headless fallback owns recovery precedence over sibling desktop publishers.
    if (this.shouldRestoreHeadlessGraph(windowId)) {
      this.pendingHeadlessPromotionWindowId = null
      this.restoreHeadlessGraphAuthority()
      return
    }
    // Keep the aggregate graph ready when another desktop publisher survives.
    const successorWindowId = this.nextGraphPublisherWindowId(windowId)
    if (successorWindowId !== null) {
      this.authoritativeWindowId = successorWindowId
      this.rendererGeneration = null
      this.rendererGraphEpoch += 1
      this.graphStatus = 'ready'
      this.setTerminalSideEffectConsumerAvailable(true)
      this.rejectAllWaiters('terminal_handle_stale')
      return
    }
    // Why: once the authoritative renderer graph disappears, fail closed for live-terminal ops instead of guessing from old state.
    if (this.graphStatus !== 'unavailable') {
      this.rendererGraphEpoch += 1
    }
    this.graphStatus = 'unavailable'
    this.setTerminalSideEffectConsumerAvailable(false)
    this.authoritativeWindowId = null
    this.rememberDetachedPreAllocatedLeaves()
    for (const [ptyId, handle] of this.handleByPtyId) {
      if (this.handleByPtyIncarnation.get(ptyId)?.handle === handle) {
        this.handleByPtyId.delete(ptyId)
      }
    }
    this.tabs.clear()
    this.leaves.clear()
    this.leavesByPtyId.clear()
    this.handles.clear()
    this.handleByLeafKey.clear()
    this.clearPtyIncarnationHandles()
    // Why: pre-allocated CLI handles must survive graph unavailability so they can be re-adopted on reconnect.
    this.rejectAllWaiters('terminal_handle_stale')
  }

  protected handleGraphReloadTimeout(windowId: number): void {
    if (windowId !== this.authoritativeWindowId || this.graphStatus !== 'reloading') {
      return
    }
    this.transitionGraphReloadToTerminalState(windowId)
  }

  protected nextGraphPublisherWindowId(excludedWindowId: number): number | null {
    for (const windowId of this.windowGraphPublications.keys()) {
      if (windowId !== excludedWindowId && windowId !== HEADLESS_RUNTIME_WINDOW_ID) {
        return windowId
      }
    }
    return null
  }
}
