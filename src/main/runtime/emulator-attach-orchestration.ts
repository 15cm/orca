import type { EmulatorBridge } from '../emulator/emulator-bridge'
import { EmulatorError } from '../emulator/emulator-errors'
import { resolveDefaultAttachDevice } from '../emulator/emulator-default-attach-device'
import type { EmulatorSessionInfo } from '../emulator/emulator-types'

export type EmulatorAttachDeps = {
  bridge: EmulatorBridge
  configuredDefaultDeviceUdid?: string
  // Re-resolved after a slow boot to catch a workspace that changed meanwhile.
  resolveWorktreeId(): Promise<string | undefined>
  notifyAutoAttach(worktreeId: string, info: EmulatorSessionInfo): void
  notifyPaneFocus(worktreeId: string): void
}

const WORKSPACE_CHANGED =
  'The workspace changed while the emulator was starting. Reattach the emulator.'

export async function attachEmulatorForWorktree(
  deps: EmulatorAttachDeps,
  params: { device?: string; focus?: boolean }
): Promise<{ attached: boolean; info?: EmulatorSessionInfo }> {
  const { bridge } = deps
  const worktreeId = await deps.resolveWorktreeId()
  // Resolved before the device pick so a default attach skips emulators other
  // worktrees already stream instead of collapsing both onto one device.
  const device =
    params.device ??
    (await resolveDefaultAttachDevice(bridge, {
      preferredDeviceId: deps.configuredDefaultDeviceUdid,
      claimedDeviceIds: bridge.getDevicesClaimedByOtherWorktrees(worktreeId)
    }))
  if (!device) {
    throw new EmulatorError(
      'emulator_device_not_found',
      'No emulator device specified. Choose a default device in Settings > Mobile Emulator or pass a device.'
    )
  }
  if (worktreeId) {
    const reusable = await bridge.getReusableActiveForWorktree(worktreeId, device)
    if (reusable) {
      // Why: renderer remounts should reconnect to the existing stream, not
      // kill it and create the stream-disconnected reload loop users see.
      notifyAttached(deps, worktreeId, reusable, params.focus)
      return { attached: true, info: reusable }
    }
    // A different requested device is an explicit switch; the bridge keeps a
    // slow-to-boot Android emulator alive for instant switch-back.
    await bridge.stopActiveForSwitch(worktreeId)
  }
  const lease = await bridge.acquireHelperForDevice(device)
  const { info } = lease
  if (!worktreeId) {
    await lease.release()
    return { attached: true, info }
  }
  try {
    if ((await deps.resolveWorktreeId()) !== worktreeId) {
      throw new EmulatorError('emulator_no_active', WORKSPACE_CHANGED)
    }
  } catch (error) {
    // Why: the workspace can disappear while a slow Android device boots.
    await lease.release({ cleanupIfUnused: true }).catch(() => {})
    if (error instanceof Error && error.message === 'selector_not_found') {
      throw new EmulatorError('emulator_no_active', WORKSPACE_CHANGED)
    }
    throw error
  }
  bridge.registerActiveEmulator(worktreeId, info, { managed: true })
  await lease.release()
  notifyAttached(deps, worktreeId, info, params.focus)
  return { attached: true, info }
}

// Default: no auto steal (mirror browser tab create/switch); --focus opts in.
function notifyAttached(
  deps: EmulatorAttachDeps,
  worktreeId: string,
  info: EmulatorSessionInfo,
  focus?: boolean
): void {
  deps.notifyAutoAttach(worktreeId, info)
  if (focus) {
    deps.notifyPaneFocus(worktreeId)
  }
}
