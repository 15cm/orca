type ResolveEmulatorAttachTargetArgs = {
  deviceTarget?: string
  selectedUdid: string | null
}

// Only an explicit choice pins the device; without one the pane sends no device
// so main can pick an emulator no other worktree is already streaming.
export function resolveEmulatorAttachTarget({
  deviceTarget,
  selectedUdid
}: ResolveEmulatorAttachTargetArgs): string | undefined {
  return deviceTarget || selectedUdid || undefined
}
