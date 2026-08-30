import type { EmulatorBridge } from '../emulator/emulator-bridge'

type CapabilityTarget = {
  device?: string
  worktreeId?: string
}

// The capability-gated app verbs (install/launch/permissions/logcat): each is
// the same "resolve target, reject unsupported backend, delegate" shape.
export async function installEmulatorApp(
  bridge: EmulatorBridge,
  target: CapabilityTarget,
  params: { path: string; reinstall?: boolean }
): Promise<void> {
  await bridge.runCapability('install', target, (backend, device) =>
    backend.installApp!(device, params.path, { reinstall: params.reinstall })
  )
}

export async function launchEmulatorApp(
  bridge: EmulatorBridge,
  target: CapabilityTarget,
  params: { package: string; activity?: string }
): Promise<void> {
  await bridge.runCapability('launch', target, (backend, device) =>
    backend.launchApp!(device, params.package, params.activity)
  )
}

export async function setEmulatorAppPermission(
  bridge: EmulatorBridge,
  target: CapabilityTarget,
  params: {
    op: 'grant' | 'revoke' | 'reset'
    package?: string
    permission?: string
  }
): Promise<void> {
  await bridge.runCapability('permissions', target, (backend, device) =>
    backend.setPermission!(device, params.op, params.package ?? '', params.permission)
  )
}

export async function captureEmulatorLogcat(
  bridge: EmulatorBridge,
  target: CapabilityTarget,
  params: { lines?: number; filters?: string[] }
): Promise<unknown> {
  return bridge.runCapability('logcat', target, (backend, device) =>
    backend.logcat!(device, { lines: params.lines, filters: params.filters })
  )
}
