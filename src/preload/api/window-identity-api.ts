import type { WindowSessionAdoption } from '../../shared/window-session-adoption'

export type WindowIdentityApi = {
  /** Id of the main window this renderer runs in, stable for the window's lifetime (reloads included);
   *  null for renderers outside a main window, which the renderer treats as one implicit window. */
  windowId: string | null
  /** Whether this window adopts the shared workspace session or opens with nothing open.
   *  Frozen at window creation; 'shared' is the pre-scoped-windows behaviour. */
  sessionAdoption: WindowSessionAdoption
}
