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
  // Why the adoption check: a window that opened with nothing open holds an empty in-memory
  // session, and every write replaces whole keyed maps — one debounce would wipe the other
  // windows' tabs off disk. See docs/reference/window-session-adoption.md.
  return (
    state.workspaceSessionReady &&
    state.hydrationSucceeded &&
    state.workspaceSessionAdoption === 'shared'
  )
}
