import type { PreloadApi } from '../api-types'
import { ipcRenderer } from 'electron'
import type { WindowScopeChangedPayload } from '../../shared/window-scope'
import { uiStateAndMenuCommandsApi } from './ui-bridge-state-and-menu-commands'
import { uiTabAndBrowserCommandsApi } from './ui-bridge-tab-and-browser-commands'
import { uiTerminalAndSessionTabsApi } from './ui-bridge-terminal-and-session-tabs'
import { uiClipboardAndWindowControlsApi } from './ui-bridge-clipboard-and-window-controls'

export const uiApi = {
  ...uiStateAndMenuCommandsApi,
  ...uiTabAndBrowserCommandsApi,
  ...uiTerminalAndSessionTabsApi,
  ...uiClipboardAndWindowControlsApi,
  getWindowScope: () => ipcRenderer.invoke('ui:getWindowScope'),
  openProjectGroupWindow: (args: Parameters<PreloadApi['ui']['openProjectGroupWindow']>[0]) =>
    ipcRenderer.invoke('ui:openProjectGroupWindow', args),
  setWindowScope: (args: Parameters<PreloadApi['ui']['setWindowScope']>[0]) =>
    ipcRenderer.invoke('ui:setWindowScope', args),
  setWindowScopeLabel: (label: string | null) => ipcRenderer.send('ui:setWindowScopeLabel', label),
  onWindowScopeChanged: (callback: (payload: WindowScopeChangedPayload) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: WindowScopeChangedPayload
    ): void => callback(payload)
    ipcRenderer.on('ui:windowScopeChanged', listener)
    return () => ipcRenderer.removeListener('ui:windowScopeChanged', listener)
  }
} satisfies PreloadApi['ui']
