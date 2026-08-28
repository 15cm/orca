/**
 * Window-scoped renderer claims about a PTY: hidden / visible / active.
 *
 * Each renderer ref-counts its own claims and reports absolute booleans, so with
 * more than one window a shared main-side Set is last-writer-wins: a background
 * window marking a pane hidden starves the window that has it in the foreground.
 * Claims are therefore kept per window and aggregated here — a PTY is droppable
 * only when EVERY window that has an opinion says hidden, and none reports it
 * visible or active.
 */
import type { BrowserWindow } from 'electron'
import { activeRendererPtys, visibleRendererPtys } from './visibility-state'

/** Windowless renderers (paired web, pop-out) and main-originated spawn marks share
 *  one bucket — exactly what single-window behavior collapses to. */
export const IMPLICIT_RENDERER_WINDOW_ID = -1

type RendererPtyWindowClaims = {
  // Why: a window that never reported on a PTY must not veto a drop, so membership is tracked apart from the hidden bit.
  touched: Set<string>
  hidden: Set<string>
  visible: Set<string>
  active: Set<string>
  /** Sidecar consumers needing live bytes with no visible view. Any window's hold suppresses the gate. */
  interest: Set<string>
}

const claimsByWindow = new Map<number, RendererPtyWindowClaims>()
const cleanupBoundWindows = new WeakSet<BrowserWindow>()

function claimsForWindow(windowId: number): RendererPtyWindowClaims {
  const existing = claimsByWindow.get(windowId)
  if (existing) {
    return existing
  }
  const created: RendererPtyWindowClaims = {
    touched: new Set(),
    hidden: new Set(),
    visible: new Set(),
    active: new Set(),
    interest: new Set()
  }
  claimsByWindow.set(windowId, created)
  return created
}

type ClaimKey = 'visible' | 'active' | 'hidden' | 'interest'

function syncDerivedUnion(union: Set<string>, key: ClaimKey, ptyId: string): boolean {
  let claimedAnywhere = false
  for (const claims of claimsByWindow.values()) {
    if (claims[key].has(ptyId)) {
      claimedAnywhere = true
      break
    }
  }
  if (!claimedAnywhere) {
    return union.delete(ptyId)
  }
  if (union.has(ptyId)) {
    return false
  }
  union.add(ptyId)
  return true
}

/** Union across windows — `isHiddenRendererPty` reports "some window called this hidden". */
const hiddenRendererPtysUnion = new Set<string>()
const deliveryInterestRendererPtysUnion = new Set<string>()

function applyClaim(
  windowId: number,
  ptyId: string,
  key: ClaimKey,
  claimed: boolean,
  union: Set<string>
): boolean {
  const claims = claimsForWindow(windowId)
  claims.touched.add(ptyId)
  if (claimed) {
    claims[key].add(ptyId)
  } else {
    claims[key].delete(ptyId)
  }
  return syncDerivedUnion(union, key, ptyId)
}

export function recordHiddenRendererPtyWindowClaim(
  windowId: number,
  ptyId: string,
  hidden: boolean
): void {
  applyClaim(windowId, ptyId, 'hidden', hidden, hiddenRendererPtysUnion)
}

/** Returns whether the cross-window union changed, so callers can skip redundant drain invalidation. */
export function recordVisibleRendererPtyWindowClaim(
  windowId: number,
  ptyId: string,
  visible: boolean
): boolean {
  return applyClaim(windowId, ptyId, 'visible', visible, visibleRendererPtys)
}

export function recordActiveRendererPtyWindowClaim(
  windowId: number,
  ptyId: string,
  active: boolean
): boolean {
  return applyClaim(windowId, ptyId, 'active', active, activeRendererPtys)
}

export function recordRendererPtyDeliveryInterestWindowClaim(
  windowId: number,
  ptyId: string,
  interested: boolean
): void {
  applyClaim(windowId, ptyId, 'interest', interested, deliveryInterestRendererPtysUnion)
}

export function hasRendererPtyDeliveryInterest(ptyId: string): boolean {
  return deliveryInterestRendererPtysUnion.has(ptyId)
}

export function countRendererPtyDeliveryInterest(): number {
  return deliveryInterestRendererPtysUnion.size
}

export function isHiddenRendererPtyInAnyWindow(ptyId: string): boolean {
  return hiddenRendererPtysUnion.has(ptyId)
}

export function getHiddenRendererPtyIdsAcrossWindows(): string[] {
  return [...hiddenRendererPtysUnion]
}

/**
 * The drop predicate. True only when at least one window called this PTY hidden and
 * every window that reported on it agrees — one foreground window is enough to veto.
 */
export function isHiddenForEveryClaimingWindow(ptyId: string): boolean {
  let markedHidden = false
  for (const claims of claimsByWindow.values()) {
    if (!claims.touched.has(ptyId)) {
      continue
    }
    if (claims.hidden.has(ptyId)) {
      markedHidden = true
      continue
    }
    // This window spoke about the PTY and does not consider it hidden: someone still needs the bytes.
    return false
  }
  return markedHidden
}

function forgetPtyInWindow(claims: RendererPtyWindowClaims, ptyId: string): void {
  claims.touched.delete(ptyId)
  claims.hidden.delete(ptyId)
  claims.visible.delete(ptyId)
  claims.active.delete(ptyId)
  claims.interest.delete(ptyId)
}

/** PTY teardown: every window's opinion about it dies with the PTY. */
export function clearRendererPtyWindowClaimsForPty(ptyId: string): {
  activeChanged: boolean
  visibleChanged: boolean
} {
  for (const claims of claimsByWindow.values()) {
    forgetPtyInWindow(claims, ptyId)
  }
  hiddenRendererPtysUnion.delete(ptyId)
  deliveryInterestRendererPtysUnion.delete(ptyId)
  return {
    activeChanged: activeRendererPtys.delete(ptyId),
    visibleChanged: visibleRendererPtys.delete(ptyId)
  }
}

/** Window closed or its page died: drop only that window's claims, never its siblings'. */
export function clearRendererPtyWindowClaims(windowId: number): boolean {
  const claims = claimsByWindow.get(windowId)
  if (!claims) {
    return false
  }
  claimsByWindow.delete(windowId)
  let activeChanged = false
  for (const ptyId of claims.touched) {
    syncDerivedUnion(hiddenRendererPtysUnion, 'hidden', ptyId)
    syncDerivedUnion(visibleRendererPtys, 'visible', ptyId)
    syncDerivedUnion(deliveryInterestRendererPtysUnion, 'interest', ptyId)
    activeChanged = syncDerivedUnion(activeRendererPtys, 'active', ptyId) || activeChanged
  }
  return activeChanged
}

/** Auto-registers teardown the first time a window reports a claim, so no registry hook is needed. */
export function bindRendererPtyWindowClaimCleanup(window: BrowserWindow | null): void {
  if (
    !window ||
    window.isDestroyed?.() === true ||
    typeof window.once !== 'function' ||
    cleanupBoundWindows.has(window)
  ) {
    return
  }
  cleanupBoundWindows.add(window)
  const windowId = window.id
  window.once('closed', () => {
    clearRendererPtyWindowClaims(windowId)
  })
}

export function resolveRendererPtyClaimWindowId(window: BrowserWindow | null): number {
  if (!window || typeof window.id !== 'number' || window.isDestroyed?.() === true) {
    return IMPLICIT_RENDERER_WINDOW_ID
  }
  bindRendererPtyWindowClaimCleanup(window)
  return window.id
}

/** Full teardown (all windows) — test seams and process-wide resets. */
export function resetAllRendererPtyWindowClaims(): boolean {
  const activeChanged = activeRendererPtys.size > 0
  claimsByWindow.clear()
  hiddenRendererPtysUnion.clear()
  deliveryInterestRendererPtysUnion.clear()
  visibleRendererPtys.clear()
  activeRendererPtys.clear()
  return activeChanged
}
