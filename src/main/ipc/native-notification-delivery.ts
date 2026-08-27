import { app, Notification } from 'electron'
import type { BrowserWindow } from 'electron'
import type {
  NotificationDispatchRequest,
  NotificationDispatchResult,
  NotificationSettings
} from '../../shared/notification-settings-types'
import { getRepoIdFromWorktreeId } from '../../shared/worktree/id'
import { parsePaneKey } from '../../shared/stable-pane-id'
import { parseWorkspaceKey } from '../../shared/workspace-scope'
import type { buildNotificationOptions } from './notification-options'
import { getEffectiveNotificationSoundId } from './notification-sound-selection'
import {
  activeNotificationsById,
  logNativeNotificationFailure,
  retainNotificationUntilRelease,
  waitForNotificationDisplay
} from './native-notification-lifecycle'
import { recordNotificationDeliveryOutcome } from './notification-permission-probe'
import { getTrustedUIRendererWindow } from './ui'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import {
  getFocusedOrLastActiveMainWindow,
  getMainWindowById,
  getMainWindowTabFocusSequence
} from '../window/main-window-registry'

export function deliverNativeNotification(
  args: NotificationDispatchRequest,
  notificationOptions: ReturnType<typeof buildNotificationOptions>,
  settings: NotificationSettings,
  runtime?: OrcaRuntimeService
): NotificationDispatchResult | Promise<NotificationDispatchResult> {
  if (getEffectiveNotificationSoundId(settings) !== 'system') {
    notificationOptions.silent = true
  } else if (process.platform === 'darwin') {
    // Why: macOS treats an unset sound as silent, so request Electron's default when using the OS sound.
    notificationOptions.sound = 'default'
  }
  const notification = new Notification(notificationOptions)
  if (args.notificationId) {
    const previous = activeNotificationsById.get(args.notificationId)
    if (previous) {
      previous.notification.close()
      previous.release()
    }
  }

  // Why: prevent GC from collecting the notification and its click handler while it's still visible.
  let clickHandler: (() => void) | null = null
  let failedHandler: ((_event: unknown, error?: string) => void) | null = null
  const entryForId: { notification: Notification; release: () => void } | null = args.notificationId
    ? { notification, release: () => {} }
    : null
  const release = retainNotificationUntilRelease(notification, () => {
    if (clickHandler) {
      notification.removeListener('click', clickHandler)
      clickHandler = null
    }
    if (failedHandler) {
      notification.removeListener('failed', failedHandler)
      failedHandler = null
    }
    if (args.notificationId && activeNotificationsById.get(args.notificationId) === entryForId) {
      activeNotificationsById.delete(args.notificationId)
    }
  })
  if (entryForId && args.notificationId) {
    entryForId.release = release
    activeNotificationsById.set(args.notificationId, entryForId)
  }

  failedHandler = (_event, error) => {
    // Why: Electron 42's macOS backend reports unsigned/delivery failures here; release now, not after the fallback timer.
    logNativeNotificationFailure(args.source, error)
    // Why: feeds the permission card's evidence.
    recordNotificationDeliveryOutcome('failed')
    release()
  }
  notification.on('failed', failedHandler)

  const targetWorktreeId = args.worktreeId
  const isGitWorktreeId = Boolean(
    targetWorktreeId &&
    targetWorktreeId.includes('::') &&
    getRepoIdFromWorktreeId(targetWorktreeId).length > 0
  )
  const isFolderWorkspaceId = parseWorkspaceKey(targetWorktreeId ?? '')?.type === 'folder'
  // Why: folder workspace ids do not have a Git repo owner, but still carry enough identity for pane navigation.
  if (targetWorktreeId && (isGitWorktreeId || isFolderWorkspaceId)) {
    const repoId = isGitWorktreeId ? getRepoIdFromWorktreeId(targetWorktreeId) : null
    clickHandler = () => {
      release()
      const paneTarget = args.paneKey ? parsePaneKey(args.paneKey) : null
      const targetTabId = paneTarget?.tabId ?? null
      const exactCandidates =
        runtime && targetTabId && paneTarget
          ? runtime
              .getWindowGraphCandidates(targetWorktreeId, targetTabId, paneTarget.leafId)
              .filter((candidate) =>
                runtime.isWindowGraphCandidate(
                  candidate.windowId,
                  targetWorktreeId,
                  targetTabId,
                  paneTarget.leafId
                )
              )
          : []
      const tabCandidates =
        runtime && targetTabId
          ? runtime.getWindowGraphCandidates(targetWorktreeId, targetTabId)
          : []
      const exactPaneCandidates = paneTarget
        ? exactCandidates.filter((candidate) => candidate.leafId === paneTarget.leafId)
        : []
      const primaryCandidates = exactPaneCandidates.length > 0 ? exactPaneCandidates : tabCandidates
      const rankCandidates = (values: typeof primaryCandidates) =>
        [...new Map(values.map((candidate) => [candidate.windowId, candidate])).values()]
          .map((candidate) => ({
            ...candidate,
            sequence: getMainWindowTabFocusSequence(
              candidate.windowId,
              targetWorktreeId,
              targetTabId!
            )
          }))
          .sort((a, b) => (b.sequence ?? -1) - (a.sequence ?? -1))
      const ranked = rankCandidates(primaryCandidates)
      const rankedTabCandidates = rankCandidates(tabCandidates)
      const historicalCandidates = ranked.filter((candidate) => candidate.sequence !== null)
      const canonicalWindowId = runtime
        ? exactPaneCandidates.length > 0 && targetTabId && paneTarget
          ? runtime.resolveOwnerWindowIdForLeaf(targetTabId, paneTarget.leafId, targetWorktreeId)
          : tabCandidates.length > 0 && targetTabId
            ? runtime.resolveOwnerWindowIdForWorktreeTab(targetWorktreeId, targetTabId)
            : null
        : null
      const canonicalCandidate =
        canonicalWindowId === null
          ? null
          : paneTarget && exactPaneCandidates.length > 0
            ? (ranked.find((candidate) => candidate.windowId === canonicalWindowId) ?? null)
            : (rankedTabCandidates.find((candidate) => candidate.windowId === canonicalWindowId) ??
              null)
      const candidatesToTry: typeof ranked = []
      const candidateWindowIds = new Set<number>()
      const appendCandidate = (candidate: (typeof ranked)[number] | null): void => {
        if (!candidate || candidateWindowIds.has(candidate.windowId)) {
          return
        }
        candidateWindowIds.add(candidate.windowId)
        candidatesToTry.push(candidate)
      }
      for (const candidate of historicalCandidates) {
        appendCandidate(candidate)
      }
      appendCandidate(canonicalCandidate)
      // Why: a stale canonical owner must not skip another live graph match.
      for (const candidate of ranked) {
        appendCandidate(candidate)
      }
      for (const candidate of rankedTabCandidates) {
        appendCandidate(candidate)
      }

      const exactCandidateWindowIds = new Set(
        exactCandidates.map((candidate) => candidate.windowId)
      )
      const isUsableWindow = (candidateWindow: BrowserWindow): boolean => {
        try {
          return !candidateWindow.isDestroyed() && !candidateWindow.webContents.isDestroyed()
        } catch {
          return false
        }
      }
      const tryNavigate = (
        candidateWindow: BrowserWindow,
        candidate?: (typeof ranked)[number]
      ): boolean => {
        if (
          !isUsableWindow(candidateWindow) ||
          (candidate &&
            runtime &&
            targetTabId &&
            !runtime.isWindowGraphCandidate(
              candidate.windowId,
              targetWorktreeId,
              targetTabId,
              exactCandidateWindowIds.has(candidate.windowId) ? paneTarget?.leafId : undefined
            ))
        ) {
          return false
        }
        try {
          if (process.platform === 'darwin') {
            app.focus({ steal: true })
          }
          if (candidateWindow.isMinimized()) {
            candidateWindow.restore()
          }
          candidateWindow.show()
          candidateWindow.focus()
          if (!isUsableWindow(candidateWindow)) {
            return false
          }
          if (repoId) {
            candidateWindow.webContents.send('ui:activateWorktree', {
              repoId,
              worktreeId: targetWorktreeId
            })
          }
          if (paneTarget) {
            if (!isUsableWindow(candidateWindow)) {
              return false
            }
            candidateWindow.webContents.send('ui:focusTerminal', {
              tabId: paneTarget.tabId,
              worktreeId: targetWorktreeId,
              leafId: paneTarget.leafId,
              ackPaneKeyOnSuccess: args.paneKey,
              flashFocusedPane: true,
              scrollToBottomIfOutputSinceLastView: true
            })
          }
          return true
        } catch {
          return false
        }
      }

      for (const candidate of candidatesToTry) {
        const candidateWindow = getMainWindowById(candidate.windowId)
        if (candidateWindow && tryNavigate(candidateWindow, candidate)) {
          return
        }
      }
      const focusedWindow = getFocusedOrLastActiveMainWindow()
      if (focusedWindow && tryNavigate(focusedWindow)) {
        return
      }
      const trustedWindow = getTrustedUIRendererWindow()
      if (trustedWindow) {
        tryNavigate(trustedWindow)
      }
    }
    notification.on('click', clickHandler)
  }

  const displayConfirmation = args.requireDisplayConfirmation
    ? waitForNotificationDisplay(notification)
    : null
  notification.show()

  if (displayConfirmation) {
    return displayConfirmation.then((displayed) => {
      if (!displayed) {
        release()
        return { delivered: false, reason: 'not-displayed' }
      }
      recordNotificationDeliveryOutcome('delivered')
      return { delivered: true }
    })
  }

  return { delivered: true }
}
