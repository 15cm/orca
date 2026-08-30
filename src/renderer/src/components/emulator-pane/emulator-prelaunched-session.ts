import {
  deviceLabel,
  simulatorPreviewStreamUrl,
  type EmulatorPaneSession,
  type EmulatorStreamInfo
} from './emulator-pane-types'

export type PrelaunchedEmulatorSessionState = {
  selectedUdid: string | null
  session: EmulatorPaneSession | null
  streamKey: string | null
  liveTarget: string | null
}

export function buildPrelaunchedEmulatorSessionState(
  info: EmulatorStreamInfo | null | undefined
): PrelaunchedEmulatorSessionState {
  const liveTarget = info?.deviceUdid || info?.device || null
  return {
    selectedUdid: liveTarget,
    session: info
      ? {
          attached: true,
          info: {
            ...info,
            displayName: deviceLabel(info),
            state: 'Booted'
          }
        }
      : null,
    streamKey: info && simulatorPreviewStreamUrl(info) ? String(Date.now()) : null,
    liveTarget
  }
}
