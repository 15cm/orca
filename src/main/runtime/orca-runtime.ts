import { installRuntimeLinearCommandSurface } from './runtime-linear-command-surface'
import { OrcaRuntimeWithResolveWaiter } from './orca-runtime-resolve-waiter'
import type { RuntimeCommandSurfaceHost } from './orca-runtime-core'
import type { PtyOwnerWindowChange } from './window-pty-ownership-priority'

class OrcaRuntimeService extends OrcaRuntimeWithResolveWaiter {
  private readonly ptyOwnerWindowById = new Map<string, number>()
  private readonly onPtyOwnerWindowsChanged?: (changes: PtyOwnerWindowChange[]) => void

  constructor(...args: ConstructorParameters<typeof OrcaRuntimeWithResolveWaiter>) {
    super(...args)
    const deps = args[2] as
      | { onPtyOwnerWindowsChanged?: (changes: PtyOwnerWindowChange[]) => void }
      | undefined
    this.onPtyOwnerWindowsChanged = deps?.onPtyOwnerWindowsChanged
  }

  resolveOwnerWindowIdForPtyId(ptyId: string): number | null {
    return this.ptyOwnerWindowById.get(ptyId) ?? null
  }

  resolvePtyIdsForOwnerWindow(windowId: number): string[] {
    return [...this.ptyOwnerWindowById].filter(([, owner]) => owner === windowId).map(([id]) => id)
  }

  registerPtyOwnerWindow(ptyId: string, windowId: number): void {
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
    if (!this.ptyOwnerWindowById.has(ptyId)) {
      return 'unavailable'
    }
    const previousWindowId = this.ptyOwnerWindowById.get(ptyId) ?? null
    if (previousWindowId === windowId) {
      return 'already-owner'
    }
    this.ptyOwnerWindowById.set(ptyId, windowId)
    this.onPtyOwnerWindowsChanged?.([{ ptyId, previousWindowId, nextWindowId: windowId }])
    return 'claimed'
  }

  listPtyOwnerWindows(): { ptyId: string; windowId: number }[] {
    return Array.from(this.ptyOwnerWindowById, ([ptyId, windowId]) => ({ ptyId, windowId }))
  }

  senderWindowOwnsTerminalHandle(handle: string, senderWindowId: number): boolean {
    const leaf = this.resolveLeafForHandle(handle)
    return leaf?.ptyId != null && this.resolveOwnerWindowIdForPtyId(leaf.ptyId) === senderWindowId
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
