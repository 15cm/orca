export type PtyOwnerWindow = { isDestroyed: () => boolean; isFocused: () => boolean }

export function isFocusedPtyOwnerWindow(window: PtyOwnerWindow | null): boolean {
  return window !== null && !window.isDestroyed() && window.isFocused()
}
