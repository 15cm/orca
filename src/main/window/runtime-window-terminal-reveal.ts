import { randomUUID } from 'node:crypto'

import { ipcMain } from 'electron'
import type { TerminalTabCreateReply } from '../../shared/terminal-reveal-identity'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import type { RuntimeNotifier } from '../runtime/runtime-notifier-contract'
import type { RuntimeWindowNotifier } from './runtime-window-notifier-registry'

type RevealOptions = Parameters<NonNullable<RuntimeNotifier['revealTerminalSession']>>[1]

export function revealTerminalSessionFromRuntime(
  runtime: OrcaRuntimeService,
  worktreeId: string,
  opts: RevealOptions,
  resolveNotifier: (ownerWindowId: number | null) => RuntimeWindowNotifier | null,
  ownerForTab: (tabId: string) => number | null,
  ownerForWorktreeTab: (worktreeId: string, tabId: string) => number | null,
  ownerForPty: (ptyId: string) => number | null
): Promise<{
  tabId: string
  title?: string | null
  identity?: TerminalTabCreateReply['identity']
}> {
  return new Promise((resolve, reject) => {
    const ownerWindowId =
      opts.tabId && opts.splitFromLeafId
        ? (runtime.resolveOwnerWindowIdForLeaf?.(opts.tabId, opts.splitFromLeafId) ?? null)
        : opts.tabId
          ? (ownerForWorktreeTab(worktreeId, opts.tabId) ?? ownerForTab(opts.tabId))
          : ownerForPty(opts.ptyId)
    const target = resolveNotifier(ownerWindowId)
    if (!target) {
      reject(new Error('runtime_unavailable'))
      return
    }
    const requestId = randomUUID()
    const expectedIdentity = opts.expectedProcessIdentity
      ? opts.tabId && opts.leafId
        ? { worktreeId, tabId: opts.tabId, leafId: opts.leafId, ptyId: opts.ptyId }
        : null
      : undefined
    if (expectedIdentity === null) {
      reject(new Error('terminal_reveal_identity_required'))
      return
    }
    const timer = setTimeout(() => {
      ipcMain.removeListener('terminal:tabCreateReply', handler)
      target.window.removeListener?.('closed', onTargetClosed)
      reject(new Error('Terminal reveal timed out'))
    }, 10_000)
    const onTargetClosed = (): void => {
      clearTimeout(timer)
      ipcMain.removeListener('terminal:tabCreateReply', handler)
      reject(new Error('runtime_unavailable'))
    }
    const handler = (event: Electron.IpcMainEvent, reply: TerminalTabCreateReply): void => {
      if (event.sender !== target.window.webContents || reply.requestId !== requestId) {
        return
      }
      clearTimeout(timer)
      ipcMain.removeListener('terminal:tabCreateReply', handler)
      target.window.removeListener?.('closed', onTargetClosed)
      if (reply.error) {
        reject(new Error(reply.error))
        return
      }
      if (
        expectedIdentity &&
        (!reply.identity ||
          reply.identity.worktreeId !== expectedIdentity.worktreeId ||
          reply.identity.tabId !== expectedIdentity.tabId ||
          reply.identity.leafId !== expectedIdentity.leafId ||
          reply.identity.ptyId !== expectedIdentity.ptyId)
      ) {
        reject(new Error('terminal_reveal_identity_mismatch'))
        return
      }
      resolve({
        tabId: reply.tabId!,
        title: reply.title,
        ...(reply.identity ? { identity: reply.identity } : {})
      })
    }
    ipcMain.on('terminal:tabCreateReply', handler)
    target.window.once('closed', onTargetClosed)
    runtime.registerPtyOwnerWindow(opts.ptyId, target.window.id)
    const sent = target.send('ui:createTerminal', {
      requestId,
      worktreeId,
      ptyId: opts.ptyId,
      title: opts.title ?? undefined,
      ...(opts.cwd ? { cwd: opts.cwd } : {}),
      ...(opts.launchConfig ? { launchConfig: opts.launchConfig } : {}),
      ...(opts.launchToken ? { launchToken: opts.launchToken } : {}),
      ...(opts.launchAgent ? { launchAgent: opts.launchAgent } : {}),
      ...(opts.viewMode ? { viewMode: opts.viewMode } : {}),
      activate: opts.activate !== false,
      ...(opts.presentation ? { presentation: opts.presentation } : {}),
      ...(opts.surfaceOwner === false ? { surfaceOwner: false } : {}),
      ...(opts.tabId !== undefined ? { tabId: opts.tabId } : {}),
      ...(opts.leafId !== undefined ? { leafId: opts.leafId } : {}),
      ...(opts.splitFromLeafId !== undefined ? { splitFromLeafId: opts.splitFromLeafId } : {}),
      ...(opts.splitDirection !== undefined ? { splitDirection: opts.splitDirection } : {}),
      ...(opts.splitTelemetrySource !== undefined
        ? { splitTelemetrySource: opts.splitTelemetrySource }
        : {}),
      ...(opts.focus !== undefined ? { focus: opts.focus } : {})
    })
    if (!sent) {
      clearTimeout(timer)
      ipcMain.removeListener('terminal:tabCreateReply', handler)
      target.window.removeListener?.('closed', onTargetClosed)
      reject(new Error('runtime_unavailable'))
    }
  })
}
