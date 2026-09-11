import type { BrowserWindow } from 'electron'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import {
  getPreferredRuntimeWindowNotifier,
  getRuntimeWindowNotifierById,
  resolveRuntimeWindowNotifier,
  type RuntimeWindowNotifier
} from './runtime-window-notifier-registry'

export function createRuntimeWindowOwnerRouting(runtime: OrcaRuntimeService): {
  sendPreferred: (channel: string, ...values: unknown[]) => boolean
  sendOwned: (ownerWindowId: number | null, channel: string, ...values: unknown[]) => boolean
  windowForOwner: (ownerWindowId: number | null) => BrowserWindow
  resolveNotifier: (ownerWindowId: number | null) => RuntimeWindowNotifier | null
  ownerForTab: (tabId: string) => number | null
  ownerForWorktreeTab: (worktreeId: string, tabId: string) => number | null
  ownerForPty: (ptyId: string) => number | null
  ownerForBrowser: (pageId: string) => number | null
} {
  const sendPreferred = (channel: string, ...values: unknown[]): boolean =>
    getPreferredRuntimeWindowNotifier()?.send(channel, ...values) ?? false
  const sendOwned = (
    ownerWindowId: number | null,
    channel: string,
    ...values: unknown[]
  ): boolean => getRuntimeWindowNotifierById(ownerWindowId)?.send(channel, ...values) ?? false
  const windowForOwner = (ownerWindowId: number | null): BrowserWindow => {
    const notifier = getRuntimeWindowNotifierById(ownerWindowId)
    if (!notifier) {
      throw new Error('runtime_unavailable')
    }
    return notifier.window
  }
  return {
    sendPreferred,
    sendOwned,
    windowForOwner,
    resolveNotifier: resolveRuntimeWindowNotifier,
    ownerForTab: (tabId) => runtime.resolveOwnerWindowIdForTabId?.(tabId) ?? null,
    ownerForWorktreeTab: (worktreeId, tabId) =>
      runtime.resolveOwnerWindowIdForWorktreeTab?.(worktreeId, tabId) ?? null,
    ownerForPty: (ptyId) => runtime.resolveOwnerWindowIdForPtyId?.(ptyId) ?? null,
    ownerForBrowser: (pageId) => runtime.resolveOwnerWindowIdForBrowserPageId?.(pageId) ?? null
  }
}
