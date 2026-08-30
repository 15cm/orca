import type { AppState } from '../store'

/**
 * The one predicate every durable session write consults: the debounced writer, the shutdown
 * checkpoint, the periodic sleeping-agent capture, and the whole-session write the CLI/mobile
 * tab-close path makes.
 */
export function shouldPersistWorkspaceSession(
  state: Pick<AppState, 'workspaceSessionReady' | 'hydrationSucceeded' | 'workspaceSessionAdoption'>
): boolean {
  // Why (issue #1158): require both flags so a hydration failure can't overwrite orca-data.json with empty error-path state.
  // Why no adoption check any more: main rebases a scoped window's write onto the keys it does
  // not own, so a second writer can no longer wipe the other windows' tabs off disk.
  // See docs/reference/window-session-adoption.md.
  return state.workspaceSessionReady && state.hydrationSucceeded
}
