import type { BrowserWindow } from 'electron'
import { agentHookServer } from '../agent-hooks/server'
import { setMigrationUnsupportedPtyListener } from '../agent-hooks/migration-unsupported-pty-state'
import { getDashboardPopoutWindow } from '../window/dashboard-popout-window'
import { isAskUserQuestionTool } from '../../shared/agent-question-answered-intent'
import {
  getSyntheticAgentTitleProfile,
  shouldDriveSyntheticAgentTitleFromHook
} from '../../shared/synthetic-agent-title'
import {
  driveSyntheticTitleFromHook,
  shouldSuppressCodexAutoApprovalSyntheticTitleFromHook,
  stopAllSyntheticTitleSpinners
} from './synthetic-title-runtime'
import { mainProcessState as state } from './main-process-state'
import { getFocusedOrLastActiveMainWindow, sendToWindow } from '../window/main-window-registry'
import { getPtyIdForPaneKey } from '../ipc/pty/pane/key-state'

export type MainWindowAgentStatusOptions = {
  window: BrowserWindow
  maybeAutoRenameBranchOnFirstWork: (event: {
    paneKey: string
    tabId: string | undefined
    worktreeId: string | undefined
    payload: { state: string; prompt?: string; lastAssistantMessage?: string }
    isReplay: boolean | undefined
  }) => void
  onRecordAgentState: (agentType: string, status: string) => void
}

const registeredWindows = new Set<BrowserWindow>()
let listenerOptions: MainWindowAgentStatusOptions | null = null

function liveWindows(): BrowserWindow[] {
  return [...registeredWindows].filter((window) => !window.isDestroyed())
}

function resolveOwnerWindow(ptyId?: string): BrowserWindow | null {
  const ownerId = ptyId ? state.runtime?.resolveOwnerWindowIdForPtyId(ptyId) : null
  const owner =
    ownerId === null || ownerId === undefined
      ? null
      : (liveWindows().find((window) => window.id === ownerId) ?? null)
  return owner ?? getFocusedOrLastActiveMainWindow() ?? state.mainWindow
}

function sendStatusToWindows(
  payload: Record<string, unknown>,
  paneKey: string,
  ptyId?: string
): void {
  const owner = resolveOwnerWindow(ptyId ?? getPtyIdForPaneKey(paneKey))
  for (const window of liveWindows()) {
    sendToWindow(window, 'agentStatus:set', {
      ...payload,
      ...(owner && window !== owner ? { presentationOnly: true as const } : {})
    })
  }
}

export function installMainWindowAgentStatusListeners(options: MainWindowAgentStatusOptions): void {
  registeredWindows.add(options.window)
  if (listenerOptions) {
    return
  }
  listenerOptions = options
  agentHookServer.setListener(
    ({
      paneKey,
      tabId,
      worktreeId,
      connectionId,
      payload,
      receivedAt,
      evidenceObservedAt,
      stateStartedAt,
      launchToken,
      providerSession,
      providerSessionOnly,
      promptInteractionKey,
      restoredUnconfirmed,
      observation,
      isReplay,
      structuredHost
    }) => {
      if (liveWindows().length === 0) {
        return
      }
      // Why: the renderer still derives structured rows from its own feed subscription; forwarding
      // these too would give one pane key two writers until that bridge is retired.
      if (structuredHost) {
        return
      }
      if (providerSessionOnly) {
        // Why: session_start just refreshes durable resume identity while Pi is idle; forward it without titles, telemetry, or status UI.
        for (const window of liveWindows()) {
          sendToWindow(window, 'agentStatus:set', {
            ...payload,
            paneKey,
            ...(launchToken ? { launchToken } : {}),
            tabId,
            worktreeId,
            connectionId,
            receivedAt,
            ...(evidenceObservedAt !== undefined ? { evidenceObservedAt } : {}),
            stateStartedAt,
            ...(providerSession ? { providerSession } : {}),
            ...(observation ? { observation } : {}),
            ...(isReplay ? { isReplay: true as const } : {}),
            providerSessionOnly: true
          })
        }
        return
      }
      if (!restoredUnconfirmed) {
        options.maybeAutoRenameBranchOnFirstWork({ paneKey, tabId, worktreeId, payload, isReplay })
      }
      const runtime = state.runtime
      const orchestration = runtime?.getAgentStatusOrchestrationContextForPaneKey(paneKey)
      const terminalHandle = runtime?.getAgentStatusTerminalHandleForPaneKey(paneKey)
      const suppressSyntheticCodexAutoApprovalTitle =
        payload.agentType === 'codex' &&
        (payload.state === 'waiting' || payload.state === 'blocked')
          ? shouldSuppressCodexAutoApprovalSyntheticTitleFromHook({
              agentType: payload.agentType,
              state: payload.state,
              launchConfig: runtime?.getAgentStatusLaunchConfigForPaneKey(paneKey, { launchToken })
            })
          : false
      const statusEvent = {
        ...payload,
        paneKey,
        ...(launchToken ? { launchToken } : {}),
        ...(terminalHandle ? { terminalHandle } : {}),
        tabId,
        worktreeId,
        connectionId,
        receivedAt,
        ...(evidenceObservedAt !== undefined ? { evidenceObservedAt } : {}),
        stateStartedAt,
        ...(providerSession ? { providerSession } : {}),
        ...(promptInteractionKey ? { promptInteractionKey } : {}),
        ...(restoredUnconfirmed ? { restoredUnconfirmed: true } : {}),
        ...(observation ? { observation } : {}),
        ...(isReplay ? { isReplay: true as const } : {}),
        ...(orchestration ? { orchestration } : {})
      }
      sendStatusToWindows(statusEvent, paneKey)
      if (!suppressSyntheticCodexAutoApprovalTitle || isAskUserQuestionTool(payload.toolName)) {
        getDashboardPopoutWindow()?.webContents.send('agentStatus:set', statusEvent)
      }
      listenerOptions?.onRecordAgentState(payload.agentType ?? 'unknown', payload.state)
      // Why: native OSC titles miss some idle/permission frames, so inject hook-derived ones to keep the renderer title tracker in sync.
      const profile = getSyntheticAgentTitleProfile(payload.agentType)
      if (
        profile &&
        shouldDriveSyntheticAgentTitleFromHook(payload.agentType, payload.state) &&
        !suppressSyntheticCodexAutoApprovalTitle
      ) {
        driveSyntheticTitleFromHook(paneKey, payload.state, profile)
      }
    }
  )
  agentHookServer.setPaneStatusClearListener((clear) => {
    if (liveWindows().length === 0) {
      return
    }
    for (const window of liveWindows()) {
      sendToWindow(window, 'agentStatus:clear', clear)
    }
    getDashboardPopoutWindow()?.webContents.send('agentStatus:clear', clear)
  })
  setMigrationUnsupportedPtyListener((event) => {
    if (liveWindows().length === 0) {
      return
    }
    if (event.type === 'set') {
      for (const window of liveWindows()) {
        sendToWindow(window, 'agentStatus:migrationUnsupported', event.entry)
      }
    } else {
      for (const window of liveWindows()) {
        sendToWindow(window, 'agentStatus:migrationUnsupportedClear', { ptyId: event.ptyId })
      }
    }
  })
}

export function clearMainWindowAgentStatusListeners(window?: BrowserWindow): void {
  if (window) {
    registeredWindows.delete(window)
  } else {
    registeredWindows.clear()
  }
  if (registeredWindows.size > 0) {
    return
  }
  agentHookServer.setListener(null)
  agentHookServer.setPaneStatusClearListener(null)
  setMigrationUnsupportedPtyListener(null)
  listenerOptions = null
  stopAllSyntheticTitleSpinners()
}
