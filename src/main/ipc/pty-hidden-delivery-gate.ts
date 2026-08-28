/**
 * Main-side hidden-delivery gate for renderer PTY byte delivery (Phase 4 of
 * the terminal model/view architecture).
 *
 * The renderer marks a PTY hidden when no visible view consumes its bytes;
 * main then drops renderer-bound delivery AFTER model ingestion — the runtime
 * already parsed the chunk, and reveal restores from the model snapshot via
 * the existing seq-guarded machinery. Any renderer party that still needs raw
 * bytes (dispatcher sidecars) registers delivery
 * interest, which suppresses the gate for that PTY.
 */
import type { GlobalSettings } from '../../shared/global-settings-types'
import {
  clearRendererPtyWindowClaims,
  clearRendererPtyWindowClaimsForPty,
  countRendererPtyDeliveryInterest,
  getHiddenRendererPtyIdsAcrossWindows,
  hasRendererPtyDeliveryInterest,
  IMPLICIT_RENDERER_WINDOW_ID,
  isHiddenForEveryClaimingWindow,
  isHiddenRendererPtyInAnyWindow,
  recordHiddenRendererPtyWindowClaim,
  recordRendererPtyDeliveryInterestWindowClaim,
  resetAllRendererPtyWindowClaims
} from './pty/delivery/renderer-pty-window-claims'

export type HiddenPtyDeliveryGateSettings = Pick<
  GlobalSettings,
  'terminalMainSideEffectAuthority' | 'terminalHiddenDeliveryGate'
>

// Why: reveal must restore from the model only when bytes were actually
// dropped. Doubles as the one-shot marker latch: the first gated drop emits a
// restore marker, and the latch is consumed only when the PTY stops being
// droppable (or by full teardown) — never by re-marking hidden, so drop memory
// survives hidden remounts, renderer reloads and a sibling window's unmark.
const droppedSinceHiddenPtys = new Set<string>()

let droppedHiddenDeliveryChars = 0
let droppedHiddenDeliveryChunks = 0

/** Gate kill switches, both read main-side: the gate only operates under main
 *  side-effect authority AND the gate-specific setting (both default on). */
export function isHiddenPtyDeliveryGateEnabled(
  settings: HiddenPtyDeliveryGateSettings | null | undefined
): boolean {
  return (
    settings?.terminalMainSideEffectAuthority !== false &&
    settings?.terminalHiddenDeliveryGate !== false
  )
}

/** One window's "no visible view needs bytes" bit. Never clears drop memory: a
 *  hidden remount or renderer reload re-marks an already-dropped PTY, and
 *  erasing the latch there would make the eventual reveal skip the restore. */
export function markHiddenRendererPty(id: string, windowId = IMPLICIT_RENDERER_WINDOW_ID): void {
  recordHiddenRendererPtyWindowClaim(windowId, id, true)
}

/** Clears this window's hidden bit. The drop latch is NOT consumed here: with several
 *  windows only the drop-policy transition knows whether bytes still get dropped, so
 *  `consumeHiddenRendererPtyDropLatch` owns the restore marker. */
export function unmarkHiddenRendererPty(id: string, windowId = IMPLICIT_RENDERER_WINDOW_ID): void {
  recordHiddenRendererPtyWindowClaim(windowId, id, false)
}

/** One-shot: true once per hidden episode in which bytes were actually dropped. */
export function consumeHiddenRendererPtyDropLatch(id: string): boolean {
  return droppedSinceHiddenPtys.delete(id)
}

export function isHiddenRendererPty(id: string): boolean {
  return isHiddenRendererPtyInAnyWindow(id)
}

/** For freeze diagnostics only: hidden ptys must appear in the per-pty report
 *  table even when the gate dropped every byte before any send/accounting. */
export function getHiddenRendererPtyIds(): string[] {
  return getHiddenRendererPtyIdsAcrossWindows()
}

/** Renderer-side ref-counted interest, surfaced as boolean transitions. Scoped per window
 *  for the same reason the hidden bit is: a sibling's reload must not release this hold. */
export function setRendererPtyDeliveryInterest(
  id: string,
  interested: boolean,
  windowId = IMPLICIT_RENDERER_WINDOW_ID
): void {
  recordRendererPtyDeliveryInterestWindowClaim(windowId, id, interested)
}

export function shouldDropHiddenRendererPtyData(
  id: string,
  settings: HiddenPtyDeliveryGateSettings | null | undefined
): boolean {
  return (
    isHiddenPtyDeliveryGateEnabled(settings) &&
    // Why the cross-window predicate: one window with the pane in the foreground vetoes the drop.
    isHiddenForEveryClaimingWindow(id) &&
    !hasRendererPtyDeliveryInterest(id)
  )
}

/** Record one gated drop. Returns whether the caller should emit the one-shot
 *  empty restore-marker chunk (first drop since this PTY went hidden). */
export function recordHiddenRendererPtyDataDrop(
  id: string,
  chars: number
): { shouldEmitRestoreMarker: boolean } {
  droppedHiddenDeliveryChars += chars
  droppedHiddenDeliveryChunks += 1
  if (droppedSinceHiddenPtys.has(id)) {
    return { shouldEmitRestoreMarker: false }
  }
  droppedSinceHiddenPtys.add(id)
  return { shouldEmitRestoreMarker: true }
}

/** Renderer process replaced (reload / crash): its ref-counted interest
 *  holds and hidden marks died with it, so keeping them would gate (or
 *  force-feed) PTYs no live renderer party asked about. Drop memory is
 *  preserved — surviving daemon/SSH PTYs may have dropped bytes the old
 *  renderer never restored; the new renderer's first hidden/visible sync
 *  re-marks or unmarks and the unmark path re-emits the restore marker. */
export function resetRendererScopedHiddenPtyDeliveryState(windowId?: number): void {
  if (windowId === undefined) {
    resetAllRendererPtyWindowClaims()
    return
  }
  clearRendererPtyWindowClaims(windowId)
}

/** Full per-PTY teardown — wired into clearProviderPtyState so every exit
 *  path (local, daemon, SSH, connection teardown) releases gate state. */
export function clearHiddenRendererPtyDeliveryState(id: string): { activeChanged: boolean } {
  const cleared = clearRendererPtyWindowClaimsForPty(id)
  droppedSinceHiddenPtys.delete(id)
  return { activeChanged: cleared.activeChanged }
}

export type HiddenRendererPtyDeliveryDebug = {
  hiddenDeliveryGatedPtyCount: number
  deliveryInterestPtyCount: number
  hiddenDeliveryDroppedChars: number
  hiddenDeliveryDroppedChunks: number
}

export function getHiddenRendererPtyDeliveryDebug(): HiddenRendererPtyDeliveryDebug {
  return {
    hiddenDeliveryGatedPtyCount: getHiddenRendererPtyIdsAcrossWindows().length,
    deliveryInterestPtyCount: countRendererPtyDeliveryInterest(),
    hiddenDeliveryDroppedChars: droppedHiddenDeliveryChars,
    hiddenDeliveryDroppedChunks: droppedHiddenDeliveryChunks
  }
}

export function resetHiddenRendererPtyDeliveryDebugCounters(): void {
  droppedHiddenDeliveryChars = 0
  droppedHiddenDeliveryChunks = 0
}

/** Test seam: reset all module state between tests. */
export function _resetHiddenRendererPtyDeliveryGateForTest(): void {
  resetAllRendererPtyWindowClaims()
  droppedSinceHiddenPtys.clear()
  resetHiddenRendererPtyDeliveryDebugCounters()
}
