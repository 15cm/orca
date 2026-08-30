import { IMPLICIT_WINDOW_ID } from '../../../shared/window-identity'
import type { WindowSessionAdoption } from '../../../shared/window-session-adoption'

/**
 * Id of the main window this renderer runs in. Renderers without one — the paired web client,
 * the dashboard pop-out — degrade to a single implicit window so per-window view-state still
 * has an owner there.
 */
export function getRendererWindowId(): string {
  const windowId = (globalThis as { api?: { windowIdentity?: { windowId?: unknown } } }).api
    ?.windowIdentity?.windowId
  // Why a type check rather than a truthiness check: the web client's missing-API proxy is truthy.
  return typeof windowId === 'string' && windowId.length > 0 ? windowId : IMPLICIT_WINDOW_ID
}

/**
 * Whether this window adopts the shared workspace session. Renderers without a main window —
 * the paired web client, the dashboard pop-out — are the implicit window and always adopt.
 */
export function getRendererWindowSessionAdoption(): WindowSessionAdoption {
  const adoption = (globalThis as { api?: { windowIdentity?: { sessionAdoption?: unknown } } }).api
    ?.windowIdentity?.sessionAdoption
  return adoption === 'scoped' ? 'scoped' : 'shared'
}
