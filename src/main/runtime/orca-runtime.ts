import { installRuntimeLinearCommandSurface } from './runtime-linear-command-surface'
import { OrcaRuntimeWithResolveWaiter } from './orca-runtime-resolve-waiter'
import type { RuntimeCommandSurfaceHost } from './orca-runtime-core'
import type { RuntimeLeafRecord } from './runtime-terminal-state-records'

class OrcaRuntimeService extends OrcaRuntimeWithResolveWaiter {
  constructor(...args: ConstructorParameters<typeof OrcaRuntimeWithResolveWaiter>) {
    super(...args)
  }

  resolveOwnerWindowIdForPtyId(ptyId: string): number | null {
    return this.ptyOwnerWindowById.get(ptyId) ?? null
  }

  resolvePtyIdsForOwnerWindow(windowId: number): string[] {
    return [...this.ptyOwnerWindowById].filter(([, owner]) => owner === windowId).map(([id]) => id)
  }

  registerPtyOwnerWindow(ptyId: string, windowId: number): void {
    if (this.suppressedPtyOwnerWindowIds.has(ptyId)) {
      return
    }
    this.transientPtyOwnerWindowById.set(ptyId, windowId)
    const previousWindowId = this.ptyOwnerWindowById.get(ptyId) ?? null
    this.ptyOwnerWindowById.set(ptyId, windowId)
    if (previousWindowId !== windowId) {
      this.onPtyOwnerWindowsChanged?.([{ ptyId, previousWindowId, nextWindowId: windowId }])
    }
  }

  claimPtyOwnerWindow(
    ptyId: string,
    windowId: number
  ): 'claimed' | 'already-owner' | 'unavailable' {
    const publication = this.windowGraphPublications.get(windowId)
    if (
      !publication ||
      ![...publication.leafKeys].some((key) => this.leaves.get(key)?.ptyId === ptyId)
    ) {
      return 'unavailable'
    }
    const previousWindowId = this.ptyOwnerWindowById.get(ptyId) ?? null
    if (previousWindowId === windowId) {
      this.explicitPtyOwnerWindowById.set(ptyId, windowId)
      return 'already-owner'
    }
    this.explicitPtyOwnerWindowById.set(ptyId, windowId)
    this.rebuildOwnerWindowIndexes()
    return 'claimed'
  }

  listPtyOwnerWindows(): { ptyId: string; windowId: number }[] {
    return Array.from(this.ptyOwnerWindowById, ([ptyId, windowId]) => ({ ptyId, windowId }))
  }

  senderWindowOwnsTerminalHandle(handle: string, senderWindowId: number): boolean {
    const leaf = this.resolveLeafForHandle(handle)
    return leaf?.ptyId != null && this.resolveOwnerWindowIdForPtyId(leaf.ptyId) === senderWindowId
  }

  resolveOwnerWindowIdForTabId(tabId: string): number | null {
    return this.tabOwnerWindowById.get(tabId) ?? null
  }
  resolveOwnerWindowIdForWorktreeTab(worktreeId: string, tabId: string): number | null {
    return this.tabOwnerWindowByWorktreeAndTabId.get(`${worktreeId}\0${tabId}`) ?? null
  }
  resolveOwnerWindowIdForLeaf(tabId: string, leafId: string): number | null {
    return this.leafOwnerWindowByKey.get(this.getLeafKey(tabId, leafId)) ?? null
  }
  resolveOwnerWindowIdForLeafId(leafId: string): number | null {
    for (const [key, owner] of this.leafOwnerWindowByKey) {
      if (key.endsWith(`::${leafId}`)) {
        return owner
      }
    }
    return null
  }
  resolveOwnerWindowIdForBrowserPageId(pageId: string): number | null {
    return this.browserPageOwnerWindowById.get(pageId) ?? null
  }
  handleWindowScopesChanged(): void {
    this.rebuildOwnerWindowIndexes()
  }
  /** Drop one renderer's contribution after its native window closes. */
  releaseWindow(windowId: number): void {
    this.dropWindowGraphContribution(windowId)
  }

  /** Retire only leaves unique to a closed publisher; siblings remain live. */
  protected dropWindowGraphContribution(windowId: number): void {
    const publication = this.windowGraphPublications.get(windowId)
    this.windowGraphPublications.delete(windowId)
    for (const [ptyId, owner] of this.transientPtyOwnerWindowById) {
      if (owner === windowId) {
        this.transientPtyOwnerWindowById.delete(ptyId)
      }
    }
    for (const [ptyId, owner] of this.explicitPtyOwnerWindowById) {
      if (owner === windowId) {
        this.explicitPtyOwnerWindowById.delete(ptyId)
      }
    }
    if (!publication) {
      this.rebuildOwnerWindowIndexes()
      return
    }
    const survivingTabs = new Set<string>()
    const survivingLeaves = new Set<string>()
    for (const other of this.windowGraphPublications.values()) {
      other.tabIds.forEach((id) => survivingTabs.add(id))
      other.leafKeys.forEach((key) => survivingLeaves.add(key))
    }
    const retiredLeaves: RuntimeLeafRecord[] = []
    for (const leafKey of publication.leafKeys) {
      if (!survivingLeaves.has(leafKey)) {
        const leaf = this.leaves.get(leafKey)
        if (leaf) {
          retiredLeaves.push(leaf)
        }
      }
    }
    this.rememberDetachedPreAllocatedLeaves(retiredLeaves)
    for (const leaf of retiredLeaves) {
      const leafKey = this.getLeafKey(leaf.tabId, leaf.leafId)
      this.invalidateLeafHandle(leafKey)
      this.leaves.delete(leafKey)
    }
    for (const tabId of publication.tabIds) {
      if (!survivingTabs.has(tabId)) {
        this.tabs.delete(tabId)
      }
    }
    this.rebuildLeafPtyIndex()
    this.rebuildOwnerWindowIndexes()
    this.refreshWritableFlags()
  }
}
type OrcaRuntimeServiceExport = RuntimeCommandSurfaceHost<OrcaRuntimeService>
const OrcaRuntimeServiceExport = OrcaRuntimeService as unknown as {
  new (...args: ConstructorParameters<typeof OrcaRuntimeService>): OrcaRuntimeServiceExport
  readonly prototype: OrcaRuntimeServiceExport
}
export { OrcaRuntimeServiceExport as OrcaRuntimeService }
installRuntimeLinearCommandSurface(OrcaRuntimeServiceExport.prototype)

export type { LegacyWorkerTerminalRecoveryResult } from './runtime-legacy-worker-terminal-recovery-types'
export type {
  RuntimeAutomationCreateInput,
  RuntimeAutomationUpdateInput
} from './runtime-automation-controller'
export type { SubscriptionRegistration } from './runtime-subscription-registry'
export type {
  OrchestrationCompatibilityCallerAuthority,
  OrchestrationCompatibilityTerminalAuthority,
  RuntimePtyDataAdmission,
  RuntimeTerminalAgentStatusEvent
} from './runtime-terminal-contracts'
export type { MessageWaitResult } from './runtime-message-waiters'
export type { AccountsSnapshot, CodexRateLimitResetRpcResult } from './runtime-account-controller'
export type {
  MobileNotificationDispatchEvent,
  MobileNotificationDismissEvent,
  MobileNotificationEvent
} from './runtime-mobile-notification-controller'
export type { RuntimeTerminalDataMeta } from './runtime-terminal-stream-consumers'
export type { RemoteFetchResult, RemoteTrackingBase } from './runtime-remote-fetch-controller'
export {
  computeTerminalTailWaitState,
  tailGainedNewerBlockedReason,
  type TerminalTailWaitState
} from './terminal-wait-tail-state'
export { appendNormalizedToTailBuffer } from './terminal-tail-buffer'
export { appendNormalizedToMultilineTailBufferUnwindowed } from './terminal-tail-redraw-buffer'
export { buildPreview } from './terminal-tail-state'
export { buildRestoredTerminalTailSeed } from './terminal-tail-restore-seed'
export { projectTerminalTailLines } from './orca-runtime-terminal-projection'
export { resolveWorktreeScanCacheTtlMs } from './runtime-worktree-scan-cache'
export type {
  RuntimeWorktreeLifecycleEvent,
  DriverState,
  PtyLayoutTarget,
  PtyLayoutState,
  ApplyLayoutResult,
  RuntimeRendererReloadFence
} from './orca-runtime-core'
export {
  AUTHORITATIVE_TERMINAL_SNAPSHOT_TIMEOUT_MS,
  WORKTREE_SCAN_ADMIN_RECONCILE_INTERVAL_MS,
  WORKTREE_SCAN_ADMIN_FINGERPRINT_TIMEOUT_MS
} from './orca-runtime-postlude'
