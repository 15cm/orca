import type { BrowserWindow } from 'electron'
import type { KeybindingOverrides } from '../../shared/keybindings'

export type CreateMainWindowOptions = {
  onNewWindow?: () => void
  /** Returns true when a manual app.quit() (Cmd+Q) is in progress, so the renderer skips the running-process confirm dialog. */
  getIsQuitting?: () => boolean
  /** Notifies the caller when the renderer vetoes unload, so the quit latch clears — a prevented beforeunload cancels the in-flight app.quit(). */
  onQuitAborted?: () => void
  /** Returns true while app-level quit is collecting every window's close decision. Why: no window may be destroyed until all live windows accepted, or a later veto leaves the app partially closed. */
  isQuitConfirmationCollecting?: () => boolean
  /** Reports that this window's renderer accepted the quit, without closing it yet. */
  onQuitWindowCloseConfirmed?: (window: BrowserWindow) => void
  onRendererProcessGone?: (
    details: Electron.RenderProcessGoneDetails,
    webContentsId: number
  ) => void
  /** Returns true when Orca should reload after renderer loss; update-relaunch/quit tear down children intentionally, so don't fight shutdown. */
  shouldRecoverRenderer?: (
    details: Electron.RenderProcessGoneDetails,
    webContentsId: number
  ) => boolean
  /** Called when consecutive auto-recoveries hit the circuit-breaker limit so the host can prompt instead of crash-looping. */
  onRendererRecoveryExhausted?: (info: {
    details: Electron.RenderProcessGoneDetails
    webContentsId: number
    recentRecoveryCount: number
  }) => void
  /** Defer renderer load until IPC handlers are registered, or eager renderer calls race into missing channels. */
  deferLoad?: boolean
  /** Reveal after load instead of first paint when startup must show the shell before slower renderer work. */
  revealOnDidFinishLoad?: boolean
  title?: string
  /** Window id the renderer is routed by; a scope key (shared/window-scope) binds the window to a project group. Defaults to a per-launch UUID. */
  windowId?: string
  getKeybindings?: () => KeybindingOverrides | undefined
  onBeforeReload?: (options: { ignoreCache: boolean; webContentsId: number }) => void
  /** Marks the in-place recovery reload so did-finish-load's PTY orphan sweep spares live sessions until restore re-attaches (#5787). */
  onBeforeRecoveryReload?: (webContentsId: number) => void
}
