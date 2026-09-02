import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'
import type { WorkspaceSessionReleasePayload } from '../../shared/workspace-session-release'
import { WORKSPACE_SESSION_RELEASE_CHANNEL } from '../../shared/workspace-session-release'

export const sessionApi = {
  // hostId is optional; main defaults it to 'local' so existing omitting call sites keep the local session partition.
  get: (hostId) => ipcRenderer.invoke('session:get', hostId),
  set: (args, hostId) => ipcRenderer.invoke('session:set', args, hostId),
  patch: (args, hostId) => ipcRenderer.invoke('session:patch', args, hostId),
  flush: () => ipcRenderer.invoke('session:flush'),
  closeTerminalTab: (args, hostId) => ipcRenderer.invoke('session:closeTerminalTab', args, hostId),
  readTerminalScrollback: (args) =>
    ipcRenderer.sendSync('session:read-terminal-scrollback-sync', args),
  /** Synchronous session save for beforeunload — blocks until flushed to disk. */
  setSync: (args, hostId) => {
    ipcRenderer.sendSync('session:set-sync', args, hostId)
  },
  onWorkspacesReleased: (
    callback: (payload: WorkspaceSessionReleasePayload) => void
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: WorkspaceSessionReleasePayload
    ): void => callback(payload)
    ipcRenderer.on(WORKSPACE_SESSION_RELEASE_CHANNEL, listener)
    return () => ipcRenderer.removeListener(WORKSPACE_SESSION_RELEASE_CHANNEL, listener)
  }
} satisfies PreloadApi['session']
