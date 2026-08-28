import {
  consumeHiddenRendererPtyDropLatch,
  markHiddenRendererPty,
  shouldDropHiddenRendererPtyData,
  unmarkHiddenRendererPty
} from '../../pty-hidden-delivery-gate'
import { IMPLICIT_RENDERER_WINDOW_ID } from './renderer-pty-window-claims'
import { invalidatePendingPtyDrainPolicy } from './visibility-state'
import type { PtyIpcSession } from '../session'

export function transitionHiddenRendererPtyDeliveryState(
  session: PtyIpcSession,
  id: string,
  hidden: boolean,
  windowId: number = IMPLICIT_RENDERER_WINDOW_ID
): { droppable: boolean; droppedWhileHidden: boolean; policyChanged: boolean } {
  const settings = session.getSettings?.()
  const wasDroppable = shouldDropHiddenRendererPtyData(id, settings)
  if (hidden) {
    markHiddenRendererPty(id, windowId)
  } else {
    unmarkHiddenRendererPty(id, windowId)
  }
  const droppable = shouldDropHiddenRendererPtyData(id, settings)
  // Why the policy transition owns the latch: with several windows a sibling's unmark can leave
  // the PTY droppable, and consuming there would swallow the restore the revealing window needs.
  const droppedWhileHidden = wasDroppable && !droppable && consumeHiddenRendererPtyDropLatch(id)
  return { droppable, droppedWhileHidden, policyChanged: wasDroppable !== droppable }
}

export function transitionSpawnHiddenRendererPtyDeliveryState(
  session: PtyIpcSession,
  id: string,
  hidden: boolean
): void {
  const transition = transitionHiddenRendererPtyDeliveryState(session, id, hidden)
  if (transition.policyChanged) {
    invalidatePendingPtyDrainPolicy(id)
  }
}
