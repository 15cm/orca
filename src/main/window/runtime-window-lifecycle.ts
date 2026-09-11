import type { BrowserWindow } from 'electron'
import type { CreateWorktreeResult } from '../../shared/worktree/create-types'
import type { WorktreeStartupLaunch } from '../../shared/worktree/launch-types'
import type {
  RuntimeMarkdownReadTabResult,
  RuntimeMarkdownSaveTabResult
} from '../../shared/mobile-markdown-document'
import type { RuntimeMobileSessionTabMove } from '../../shared/runtime-types'
import { runWorktreeChangeInvalidators } from '../ipc/worktree-change-invalidators'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { requestMobileMarkdownFromRenderer } from './mobile-markdown-request-relay'
import { registerRendererDocumentNavigation } from './renderer-document-navigation'
import { createRuntimeRendererNotificationSender } from './runtime-renderer-notification-sender'
import { requestSessionTabCloseFromRenderer } from './session-tab-close-request-relay'
import { broadcastRuntimeWindowNotification } from './runtime-window-notifier-registry'
import { requestTerminalTabCloseFromRenderer } from './terminal-tab-close-request-relay'
import { createRuntimeWindowOwnerRouting } from './runtime-window-owner-routing'
import { registerRuntimeWindowNotifierLifecycle } from './runtime-window-notifier-lifecycle'
import { revealTerminalSessionFromRuntime } from './runtime-window-terminal-reveal'

export function registerRuntimeWindowLifecycle(
  mainWindow: BrowserWindow,
  runtime: OrcaRuntimeService
): void {
  runtime.attachWindow(mainWindow.id)
  mainWindow.once('closed', () => runtime.releaseWindow(mainWindow.id))
  const mainWebContents = mainWindow.webContents
  const rendererNotifications = createRuntimeRendererNotificationSender({
    isWindowDestroyed: () => mainWindow.isDestroyed(),
    webContents: mainWebContents,
    onFailure: (reason) => runtime.markGraphReloadFailed(mainWindow.id, reason)
  })
  registerRuntimeWindowNotifierLifecycle(mainWindow, runtime, rendererNotifications)
  const {
    sendPreferred,
    sendOwned,
    windowForOwner,
    resolveNotifier,
    ownerForTab,
    ownerForWorktreeTab,
    ownerForPty,
    ownerForBrowser
  } = createRuntimeWindowOwnerRouting(runtime)
  runtime.setNotifier({
    worktreesChanged: (repoId, renamed) => {
      // Why: clear scan caches before the renderer handles this event, so it can't read stale TTL entries after a mutation.
      runWorktreeChangeInvalidators(repoId)
      broadcastRuntimeWindowNotification(
        'worktrees:changed',
        renamed ? { repoId, renamed } : { repoId }
      )
    },
    worktreeBaseStatus: (event) => broadcastRuntimeWindowNotification('worktree:baseStatus', event),
    worktreeRemoteBranchConflict: (event) =>
      broadcastRuntimeWindowNotification('worktree:remoteBranchConflict', event),
    reposChanged: () => broadcastRuntimeWindowNotification('repos:changed'),
    automationsChanged: (payload) =>
      broadcastRuntimeWindowNotification('automations:changed', payload),
    activateWorktree: (
      repoId,
      worktreeId,
      setup?: CreateWorktreeResult['setup'],
      startup?: WorktreeStartupLaunch,
      defaultTabs?: CreateWorktreeResult['defaultTabs']
    ) => {
      sendPreferred('ui:activateWorktree', {
        repoId,
        worktreeId,
        ...(setup ? { setup } : {}),
        ...(startup ? { startup } : {}),
        ...(defaultTabs ? { defaultTabs } : {})
      })
    },
    createTerminal: (worktreeId, opts) =>
      sendPreferred('ui:createTerminal', {
        worktreeId,
        command: opts.command,
        ...(opts.cwd ? { cwd: opts.cwd } : {}),
        ...(opts.env ? { env: opts.env } : {}),
        title: opts.title,
        ...(opts.presentation ? { presentation: opts.presentation } : {})
      }),
    revealTerminalSession: (worktreeId, opts) =>
      revealTerminalSessionFromRuntime(
        runtime,
        worktreeId,
        opts,
        resolveNotifier,
        ownerForTab,
        ownerForWorktreeTab,
        ownerForPty
      ),
    resolveLegacyWorkerTerminalRecovery: (paneKey, resolution, ptyId) =>
      sendOwned(ptyId ? ownerForPty(ptyId) : null, 'agentStatus:legacyWorkerTerminalRecovery', {
        paneKey,
        resolution,
        ...(ptyId ? { ptyId } : {})
      }),
    splitTerminal: (tabId, paneRuntimeId, opts) => {
      sendOwned(
        opts.sourceLeafId
          ? (runtime.resolveOwnerWindowIdForLeafId?.(opts.sourceLeafId) ?? null)
          : ownerForTab(tabId),
        'ui:splitTerminal',
        {
          tabId,
          paneRuntimeId,
          direction: opts.direction,
          command: opts.command,
          worktreeId: opts.worktreeId,
          sourceLeafId: opts.sourceLeafId,
          telemetrySource: opts.telemetrySource,
          newLeafId: opts.newLeafId
        }
      )
    },
    renameTerminal: (tabId, title) =>
      sendOwned(ownerForTab(tabId), 'ui:renameTerminal', { tabId, title }),
    focusTerminal: (tabId, worktreeId, leafId) =>
      sendOwned(
        leafId
          ? (runtime.resolveOwnerWindowIdForLeaf?.(tabId, leafId) ?? null)
          : ownerForWorktreeTab(worktreeId, tabId),
        'ui:focusTerminal',
        { tabId, worktreeId, leafId }
      ),
    focusEditorTab: (tabId, worktreeId) =>
      sendOwned(ownerForWorktreeTab(worktreeId, tabId) ?? ownerForTab(tabId), 'ui:focusEditorTab', {
        tabId,
        worktreeId
      }),
    closeSessionTab: (tabId, worktreeId) =>
      requestSessionTabCloseFromRenderer(
        windowForOwner(ownerForWorktreeTab(worktreeId, tabId)),
        tabId,
        worktreeId
      ),
    moveSessionTab: (worktreeId: string, move: RuntimeMobileSessionTabMove) =>
      sendOwned(ownerForWorktreeTab(worktreeId, move.tabId), 'ui:moveSessionTab', {
        worktreeId,
        ...move
      }),
    openFile: (worktreeId, filePath, relativePath, runtimeEnvironmentId?) =>
      sendPreferred('ui:openFileFromMobile', {
        worktreeId,
        filePath,
        relativePath,
        runtimeEnvironmentId
      }),
    openDiff: (worktreeId, filePath, relativePath, staged, runtimeEnvironmentId?) =>
      sendPreferred('ui:openDiffFromMobile', {
        worktreeId,
        filePath,
        relativePath,
        staged,
        runtimeEnvironmentId
      }),
    readMobileMarkdownTab: (worktreeId, tabId) =>
      requestMobileMarkdownFromRenderer(
        windowForOwner(ownerForWorktreeTab(worktreeId, tabId) ?? ownerForTab(tabId)),
        {
          operation: 'read',
          worktreeId,
          tabId
        }
      ) as Promise<RuntimeMarkdownReadTabResult>,
    saveMobileMarkdownTab: (worktreeId, tabId, baseVersion, content) =>
      requestMobileMarkdownFromRenderer(
        windowForOwner(ownerForWorktreeTab(worktreeId, tabId) ?? ownerForTab(tabId)),
        {
          operation: 'save',
          worktreeId,
          tabId,
          baseVersion,
          content
        }
      ) as Promise<RuntimeMarkdownSaveTabResult>,
    closeTerminal: (tabId, paneRuntimeId) =>
      sendOwned(ownerForTab(tabId), 'ui:closeTerminal', { tabId, paneRuntimeId }),
    closeTerminalTab: (tabId, options) =>
      requestTerminalTabCloseFromRenderer(windowForOwner(ownerForTab(tabId)), tabId, options),
    sleepWorktree: (worktreeId) => sendPreferred('ui:sleepWorktree', { worktreeId }),
    resumeSleepingAgents: (worktreeId) => sendPreferred('ui:resumeSleepingAgents', { worktreeId }),
    terminalFitOverrideChanged: (ptyId, mode, cols, rows) =>
      resolveNotifier(ownerForPty(ptyId))?.send('runtime:terminalFitOverrideChanged', {
        ptyId,
        mode,
        cols,
        rows
      }),
    terminalDriverChanged: (ptyId, driver) =>
      resolveNotifier(ownerForPty(ptyId))?.send('runtime:terminalDriverChanged', {
        ptyId,
        driver
      }),
    nativeChatLaunchDraftResolved: (tabId, resolution) =>
      resolveNotifier(ownerForTab(tabId))?.send('runtime:nativeChatLaunchDraftResolved', {
        tabId,
        ...resolution
      }),
    browserDriverChanged: (browserPageId, driver) =>
      resolveNotifier(ownerForBrowser(browserPageId))?.send('runtime:browserDriverChanged', {
        browserPageId,
        driver
      }),
    browserRemoteViewersChanged: (browserPageId, hasRemoteViewers) =>
      resolveNotifier(ownerForBrowser(browserPageId))?.send('runtime:browserRemoteViewersChanged', {
        browserPageId,
        hasRemoteViewers
      }),
    clientHostedBrowserRowsChanged: (event) =>
      sendPreferred('runtime:clientHostedBrowserRowsChanged', event)
  })
  registerRendererDocumentNavigation(mainWebContents, () => {
    rendererNotifications.onMainFrameReloadStarted()
    const fence = runtime.markRendererReloading(mainWindow.id)
    return () => {
      if (fence && runtime.markRendererReloadCancelled(mainWindow.id, fence)) {
        rendererNotifications.onMainFrameReloadCancelled()
      }
    }
  })
  mainWebContents.on('did-finish-load', () => {
    rendererNotifications.onMainFrameLoadFinished()
  })
  mainWebContents.on('render-process-gone', () => {
    rendererNotifications.onRendererProcessGone()
  })
}
