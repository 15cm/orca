import { beforeEach, describe, expect, it } from 'vitest'
import {
  _resetHiddenRendererPtyDeliveryGateForTest,
  getHiddenRendererPtyDeliveryDebug,
  isHiddenRendererPty,
  markHiddenRendererPty,
  setRendererPtyDeliveryInterest,
  shouldDropHiddenRendererPtyData,
  unmarkHiddenRendererPty
} from '../../pty-hidden-delivery-gate'
import {
  clearRendererPtyWindowClaims,
  clearRendererPtyWindowClaimsForPty,
  IMPLICIT_RENDERER_WINDOW_ID,
  isHiddenForEveryClaimingWindow,
  recordActiveRendererPtyWindowClaim,
  recordVisibleRendererPtyWindowClaim
} from './renderer-pty-window-claims'
import { activeRendererPtys, visibleRendererPtys } from './visibility-state'

const PTY_ID = 'pty-1'
const FOREGROUND_WINDOW = 11
const BACKGROUND_WINDOW = 22

describe('renderer pty window claims', () => {
  beforeEach(() => {
    _resetHiddenRendererPtyDeliveryGateForTest()
  })

  it('lets a foreground window veto a sibling window hiding the same PTY', () => {
    // The field freeze: a second window mounts the session's panes offscreen and marks them
    // hidden, and the shared main-side set starved the window showing the terminal.
    unmarkHiddenRendererPty(PTY_ID, FOREGROUND_WINDOW)
    recordVisibleRendererPtyWindowClaim(FOREGROUND_WINDOW, PTY_ID, true)

    markHiddenRendererPty(PTY_ID, BACKGROUND_WINDOW)

    expect(shouldDropHiddenRendererPtyData(PTY_ID, {})).toBe(false)
    // The diagnostics union still reports the hidden mark so a freeze report keeps the evidence.
    expect(isHiddenRendererPty(PTY_ID)).toBe(true)
  })

  it('drops once every window that reported on the PTY agrees it is hidden', () => {
    unmarkHiddenRendererPty(PTY_ID, FOREGROUND_WINDOW)
    recordVisibleRendererPtyWindowClaim(FOREGROUND_WINDOW, PTY_ID, true)
    markHiddenRendererPty(PTY_ID, BACKGROUND_WINDOW)
    expect(shouldDropHiddenRendererPtyData(PTY_ID, {})).toBe(false)

    recordVisibleRendererPtyWindowClaim(FOREGROUND_WINDOW, PTY_ID, false)
    markHiddenRendererPty(PTY_ID, FOREGROUND_WINDOW)

    expect(shouldDropHiddenRendererPtyData(PTY_ID, {})).toBe(true)
  })

  it('keeps single-window behavior: a hidden mark wins over this window own visible claim', () => {
    // A pane can report visible while a watcher holds the hidden claim; main still drops and
    // the reveal restores from the model snapshot.
    recordVisibleRendererPtyWindowClaim(IMPLICIT_RENDERER_WINDOW_ID, PTY_ID, true)
    markHiddenRendererPty(PTY_ID)

    expect(shouldDropHiddenRendererPtyData(PTY_ID, {})).toBe(true)
  })

  it('never drops a PTY no window has called hidden', () => {
    recordVisibleRendererPtyWindowClaim(FOREGROUND_WINDOW, PTY_ID, false)

    expect(isHiddenForEveryClaimingWindow(PTY_ID)).toBe(false)
    expect(shouldDropHiddenRendererPtyData(PTY_ID, {})).toBe(false)
  })

  it('unions visible and active across windows', () => {
    recordVisibleRendererPtyWindowClaim(FOREGROUND_WINDOW, PTY_ID, true)
    recordActiveRendererPtyWindowClaim(BACKGROUND_WINDOW, PTY_ID, true)
    expect(visibleRendererPtys.has(PTY_ID)).toBe(true)
    expect(activeRendererPtys.has(PTY_ID)).toBe(true)

    // One window dropping its claim must not clear the union another window still holds.
    recordActiveRendererPtyWindowClaim(FOREGROUND_WINDOW, PTY_ID, false)
    expect(activeRendererPtys.has(PTY_ID)).toBe(true)

    recordActiveRendererPtyWindowClaim(BACKGROUND_WINDOW, PTY_ID, false)
    expect(activeRendererPtys.has(PTY_ID)).toBe(false)
  })

  it('reports the union change so callers can skip redundant drain invalidation', () => {
    expect(recordActiveRendererPtyWindowClaim(FOREGROUND_WINDOW, PTY_ID, true)).toBe(true)
    expect(recordActiveRendererPtyWindowClaim(BACKGROUND_WINDOW, PTY_ID, true)).toBe(false)
    expect(recordActiveRendererPtyWindowClaim(FOREGROUND_WINDOW, PTY_ID, false)).toBe(false)
    expect(recordActiveRendererPtyWindowClaim(BACKGROUND_WINDOW, PTY_ID, false)).toBe(true)
  })

  it('clears only the closed window claims, leaving its siblings intact', () => {
    recordVisibleRendererPtyWindowClaim(FOREGROUND_WINDOW, PTY_ID, true)
    unmarkHiddenRendererPty(PTY_ID, FOREGROUND_WINDOW)
    markHiddenRendererPty(PTY_ID, BACKGROUND_WINDOW)

    clearRendererPtyWindowClaims(BACKGROUND_WINDOW)

    expect(isHiddenRendererPty(PTY_ID)).toBe(false)
    expect(visibleRendererPtys.has(PTY_ID)).toBe(true)
    expect(shouldDropHiddenRendererPtyData(PTY_ID, {})).toBe(false)
  })

  it('re-engages the gate when the window that vetoed the drop closes', () => {
    unmarkHiddenRendererPty(PTY_ID, FOREGROUND_WINDOW)
    recordVisibleRendererPtyWindowClaim(FOREGROUND_WINDOW, PTY_ID, true)
    markHiddenRendererPty(PTY_ID, BACKGROUND_WINDOW)
    expect(shouldDropHiddenRendererPtyData(PTY_ID, {})).toBe(false)

    clearRendererPtyWindowClaims(FOREGROUND_WINDOW)

    expect(visibleRendererPtys.has(PTY_ID)).toBe(false)
    expect(shouldDropHiddenRendererPtyData(PTY_ID, {})).toBe(true)
  })

  it('keeps a sidecar delivery-interest hold alive when another window reloads', () => {
    markHiddenRendererPty(PTY_ID, FOREGROUND_WINDOW)
    setRendererPtyDeliveryInterest(PTY_ID, true, FOREGROUND_WINDOW)
    markHiddenRendererPty(PTY_ID, BACKGROUND_WINDOW)
    expect(shouldDropHiddenRendererPtyData(PTY_ID, {})).toBe(false)

    // The other window's page dies; its claims go, the interest hold does not.
    clearRendererPtyWindowClaims(BACKGROUND_WINDOW)
    expect(shouldDropHiddenRendererPtyData(PTY_ID, {})).toBe(false)
    expect(getHiddenRendererPtyDeliveryDebug().deliveryInterestPtyCount).toBe(1)

    clearRendererPtyWindowClaims(FOREGROUND_WINDOW)
    expect(getHiddenRendererPtyDeliveryDebug().deliveryInterestPtyCount).toBe(0)
  })

  it('drops every window claim on PTY teardown', () => {
    recordVisibleRendererPtyWindowClaim(FOREGROUND_WINDOW, PTY_ID, true)
    recordActiveRendererPtyWindowClaim(FOREGROUND_WINDOW, PTY_ID, true)
    markHiddenRendererPty(PTY_ID, BACKGROUND_WINDOW)

    expect(clearRendererPtyWindowClaimsForPty(PTY_ID)).toEqual({
      activeChanged: true,
      visibleChanged: true
    })

    expect(isHiddenForEveryClaimingWindow(PTY_ID)).toBe(false)
    expect(visibleRendererPtys.has(PTY_ID)).toBe(false)
    expect(getHiddenRendererPtyDeliveryDebug().hiddenDeliveryGatedPtyCount).toBe(0)
  })
})
