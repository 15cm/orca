// Why: the window-control IPC handlers register once for the whole app. The latch lives
// in its own electron-free module so test harnesses can reset it without importing the
// electron-bound handler module (which would deadlock an electron mock factory).
let windowControlHandlersRegistered = false

/** Returns true when this call claimed the one-time registration. */
export function claimWindowControlRegistration(): boolean {
  if (windowControlHandlersRegistered) {
    return false
  }
  windowControlHandlersRegistered = true
  return true
}

export function _resetWindowControlIpcHandlersForTests(): void {
  // Why: tests replace the ipcMain mock between cases while this latch is process-wide.
  windowControlHandlersRegistered = false
}
