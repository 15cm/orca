import type { EmulatorBridge } from './emulator-bridge'
import { pickDefaultSimulatorDevice } from './emulator-availability'

type ResolveDefaultAttachDeviceOptions = {
  // The user's configured default; honored unless another worktree holds it.
  preferredDeviceId?: string
  // Devices other worktrees already stream, so two workspaces don't collide on one emulator.
  claimedDeviceIds?: ReadonlySet<string>
}

// Resolves a default device to attach when none is specified: the iOS default
// picker first (booted iPhone etc. on macOS), else the first booted (else first)
// device across host backends, e.g. Android on Windows/Linux.
export async function resolveDefaultAttachDevice(
  bridge: EmulatorBridge,
  options: ResolveDefaultAttachDeviceOptions = {}
): Promise<string | undefined> {
  const claimed = options.claimedDeviceIds ?? new Set<string>()
  if (options.preferredDeviceId && !claimed.has(options.preferredDeviceId)) {
    return options.preferredDeviceId
  }
  const free = await pickFreeDevice(bridge, claimed)
  // Every device is taken: keep the pre-existing shared-device behavior rather
  // than failing an attach the user could previously make.
  return free ?? options.preferredDeviceId ?? (await pickFreeDevice(bridge, new Set()))
}

async function pickFreeDevice(
  bridge: EmulatorBridge,
  claimed: ReadonlySet<string>
): Promise<string | undefined> {
  let iosDefault: string | undefined
  try {
    const simulators = (await bridge.listSimulators()).filter((device) => !claimed.has(device.udid))
    iosDefault = pickDefaultSimulatorDevice(simulators)?.udid
  } catch {
    iosDefault = undefined
  }
  if (iosDefault) {
    return iosDefault
  }
  const all = (await bridge.listAllDevices()).filter((row) => !claimed.has(row.id))
  return (all.find((row) => row.state === 'booted') ?? all[0])?.id
}
