import type { WindowScope } from './window-scope'

/**
 * What a window does with the workspace session, decided once when the window is created and
 * frozen for its lifetime (reloads included).
 *
 * There is one workspace session and no per-window routing in `main/ipc/session.ts`, so a window
 * either adopts that shared session or opens with none. Partitioning the session per window adds
 * a third arm carrying the partition key, and the same call sites read it — see
 * `docs/reference/window-session-adoption.md`.
 */
export type WindowSessionAdoption =
  /** Reads and writes the profile-wide session: every window before scoped windows existed. */
  | 'shared'
  /** Opens with nothing open and never writes; what happens in it lives for the window's life. */
  | 'empty'

const WINDOW_SESSION_ADOPTIONS: readonly WindowSessionAdoption[] = ['shared', 'empty']

/**
 * Why argv rather than IPC: this is frozen at creation, so it rides the same sandboxed-preload
 * channel as the window id (see shared/window-identity) and is readable before first paint.
 */
export const WINDOW_SESSION_ADOPTION_ARGV_FLAG = '--orca-window-session='

export function formatWindowSessionAdoptionArgument(adoption: WindowSessionAdoption): string {
  return `${WINDOW_SESSION_ADOPTION_ARGV_FLAG}${adoption}`
}

/** null when the flag is absent or unreadable; callers degrade to the pre-feature 'shared'. */
export function parseWindowSessionAdoptionFromArgv(
  argv: readonly string[]
): WindowSessionAdoption | null {
  for (const argument of argv) {
    if (!argument.startsWith(WINDOW_SESSION_ADOPTION_ARGV_FLAG)) {
      continue
    }
    const value = argument.slice(WINDOW_SESSION_ADOPTION_ARGV_FLAG.length).trim()
    return WINDOW_SESSION_ADOPTIONS.find((adoption) => adoption === value) ?? null
  }
  return null
}

/**
 * A project window opened while another window is already up starts empty: that other window
 * already shows the shared session and owns its writes, so adopting it would render the same
 * workspaces twice and put a second writer on one blob.
 *
 * The launch's first window always adopts, scoped or not — relaunching into a window with no tabs
 * is the regression this rule exists to prevent, and it is also the seam phase 2 needs: once the
 * open scopes reopen at launch, each gets its own partition instead of this all-or-nothing answer.
 */
export function resolveWindowSessionAdoption(input: {
  scope: WindowScope | null
  scopedWindowsEnabled: boolean
  otherMainWindowsOpen: boolean
}): WindowSessionAdoption {
  return input.scopedWindowsEnabled && input.scope !== null && input.otherMainWindowsOpen
    ? 'empty'
    : 'shared'
}
