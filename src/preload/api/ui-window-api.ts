import type { ClipboardImageThumbnail } from '../../shared/clipboard-image'
import type { ReadClipboardTextOptions } from '../../shared/clipboard-text'
import type { NativeFileDropPayload } from '../../shared/native-file-drop'
import type {
  RichMarkdownContextMenuCommandPayload,
  RichMarkdownContextMenuTableTarget
} from '../../shared/rich-markdown-context-menu'
import type {
  ProjectGroupWindowOpenResult,
  WindowScopeChangedPayload,
  WindowScopeChangeResult,
  WindowScopeSnapshot
} from '../../shared/window-scope'

/** Project group a window is (or is asked to be) bound to; the label feeds the window title. */
export type ProjectGroupWindowArgs = {
  projectGroupId: string
  projectLabel?: string | null
}

export type UiWindowApi = {
  readClipboardText: (options?: ReadClipboardTextOptions) => Promise<string>
  readSelectionClipboardText: (options?: ReadClipboardTextOptions) => Promise<string>
  saveClipboardImageAsTempFile: (args?: {
    connectionId?: string | null
    runtimeEnvironmentId?: string | null
  }) => Promise<string | null>
  readClipboardImageThumbnail: () => Promise<ClipboardImageThumbnail | null>
  writeClipboardText: (text: string) => Promise<void>
  writeTerminalClipboardText: (text: string) => Promise<void>
  writeSelectionClipboardText: (text: string) => Promise<void>
  writeClipboardImage: (dataUrl: string) => Promise<void>
  performNativePaste: (options?: { mode?: 'paste' | 'paste-and-match-style' }) => void
  performNativeSelectionAction: (action: 'copy' | 'select-all') => void
  writeClipboardFile: (
    args:
      | {
          filePath: string
          connectionId?: string | null
        }
      | string
  ) => Promise<{ ok: boolean; reason?: string }>
  onFileDrop: (callback: (data: NativeFileDropPayload) => void) => () => void
  getZoomLevel: () => number
  setZoomLevel: (level: number) => void
  syncTrafficLights: (zoomFactor: number) => void
  setMarkdownEditorFocused: (focused: boolean) => void
  setRichMarkdownContextMenuTarget: (target: RichMarkdownContextMenuTableTarget | null) => void
  setTerminalInputFocused: (focused: boolean) => void
  setFloatingFocus: (state: { panelFocused: boolean; terminalFocused: boolean }) => void
  setShortcutRecorderFocused: (focused: boolean) => void
  onRichMarkdownContextCommand: (
    callback: (payload: RichMarkdownContextMenuCommandPayload) => void
  ) => () => void
  onFullscreenChanged: (callback: (isFullScreen: boolean) => void) => () => void
  minimize: () => void
  maximize: () => void
  isMaximized: () => Promise<boolean>
  onMaximizeChanged: (callback: (isMaximized: boolean) => void) => () => void
  requestClose: () => void
  popupMenu: () => void
  onWindowCloseRequested: (callback: (data: { isQuitting: boolean }) => void) => () => void
  confirmWindowClose: () => void
  cancelWindowClose: () => void
  notifyWindowRevealed: () => void
  /** Main is the authority on the window's scope (shared/window-scope); never derive it from argv. */
  getWindowScope: () => Promise<WindowScopeSnapshot>
  /** One window per project: reveals the existing window instead of opening a second. */
  openProjectGroupWindow: (args: ProjectGroupWindowArgs) => Promise<ProjectGroupWindowOpenResult>
  /** Re-keys this window onto a project group, or null to make it a free window again. */
  setWindowScope: (args: ProjectGroupWindowArgs | null) => Promise<WindowScopeChangeResult>
  setWindowScopeLabel: (label: string | null) => void
  onWindowScopeChanged: (callback: (payload: WindowScopeChangedPayload) => void) => () => void
}
