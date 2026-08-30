import { EmulatorError } from './emulator-errors'
import { deriveAxUrlFromStreamUrl } from './serve-sim-detached-session'
import type { EmulatorSessionInfo } from './emulator-types'
import type { EmulatorBackend } from './backends/emulator-backend'

type AccessibilityTreeSessionLookup = {
  forWorktree(worktreeId: string): EmulatorSessionInfo | null
  forDevice(udid: string): EmulatorSessionInfo | null
}

// Reads the AX tree from the backend that owns the device; only iOS needs the
// session's serve-sim endpoint, so the lookup is resolved here rather than in
// the backend.
export async function requestEmulatorAccessibilityTree(
  backend: EmulatorBackend,
  device: string,
  worktreeId: string | undefined,
  sessions: AccessibilityTreeSessionLookup
): Promise<unknown> {
  if (backend.kind !== 'ios') {
    return backend.accessibilityTree!(device)
  }
  const udid = await backend.resolveDeviceId(device)
  // Fall back to the udid-keyed session so an explicit --device read works
  // from a worktree with no active emulator (matching tap/type reachability);
  // sessions are stored once per udid, so both lookups hit the same state.
  const session = (worktreeId ? sessions.forWorktree(worktreeId) : null) ?? sessions.forDevice(udid)
  if (worktreeId && session && session.deviceUdid !== udid) {
    throw new EmulatorError(
      'emulator_no_active',
      `iOS simulator ${udid} is not active for this worktree (active: ${session.deviceUdid}); attach the requested simulator first.`
    )
  }
  // Heal sessions registered without an axUrl (parse-time derivation only
  // covers fresh --detach output) by deriving it from the mjpeg stream URL.
  const axUrl = session?.axUrl ?? deriveAxUrlFromStreamUrl(session?.streamUrl)
  return backend.accessibilityTree!(udid, axUrl)
}
