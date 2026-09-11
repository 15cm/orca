/**
 * How a renderer learns which main window it runs in.
 *
 * Why argv rather than IPC: main windows load with `sandbox: true`, and the sandboxed preload still
 * receives `process.argv` (Electron appends `webPreferences.additionalArguments` to it). That makes
 * the id available synchronously before any IPC channel exists, with no blocking `sendSync` on the
 * renderer's first paint path.
 *
 * Why a per-launch id rather than `BrowserWindow.id`: Electron ids restart from 1 every launch, so
 * they can never anchor durable state. A future window profile carries its own stable id; until
 * then this id only needs to be unique for the lifetime of the process.
 */
export const WINDOW_ID_ARGV_FLAG = '--orca-window-id='

/** Identity a renderer without a main window reports (paired web client, dashboard pop-out). */
export const IMPLICIT_WINDOW_ID = 'implicit-window'

export function formatWindowIdArgument(windowId: string): string {
  return `${WINDOW_ID_ARGV_FLAG}${windowId}`
}

export function parseWindowIdFromArgv(argv: readonly string[]): string | null {
  for (const argument of argv) {
    if (!argument.startsWith(WINDOW_ID_ARGV_FLAG)) {
      continue
    }
    const windowId = argument.slice(WINDOW_ID_ARGV_FLAG.length).trim()
    return windowId.length > 0 ? windowId : null
  }
  return null
}
