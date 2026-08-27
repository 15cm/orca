import type { PtyOwnerWindowDescriptor } from '../../../../shared/pty-window-ownership'

/** A mirror pane shows the notice only while scoped windows exist this launch; the flag off means one window, no owners to name. */
export function shouldShowForeignWindowPaneOverlay(
  foreignOwner: PtyOwnerWindowDescriptor | null,
  scopedWindowsEnabled: boolean
): foreignOwner is PtyOwnerWindowDescriptor {
  return scopedWindowsEnabled && foreignOwner !== null
}
