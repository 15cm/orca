export type WindowIdentityApi = {
  /** Id of the main window this renderer runs in, stable for the window's lifetime (reloads included);
   *  null for renderers outside a main window, which the renderer treats as one implicit window. */
  windowId: string | null
}
