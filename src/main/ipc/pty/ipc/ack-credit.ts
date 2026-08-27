import { getPtyIpc } from '../../pty-host-bindings'
import { tryGetProviderForPty } from '../provider/registry'
import { applyCumulativeAck } from '../delivery/accounting'
import { isPtyOwnerWindowSender } from '../delivery/owner-window'
import type { PtyIpcSession } from '../session'

/** Renderer → main credit lane: per-chunk/cumulative ACKs and the resync probe's totals. */
export function installPtyAckCreditIpc(session: PtyIpcSession): void {
  const ipcMain = getPtyIpc()

  // Why: fire-and-forget — clears the DaemonPtyAdapter's sticky cold-restore cache after the renderer consumed it; no-op for non-daemon providers.
  ipcMain.removeAllListeners('pty:ackColdRestore')
  ipcMain.on('pty:ackColdRestore', (_event, args: { id: string }) => {
    const provider = tryGetProviderForPty(args.id)
    if (provider && 'ackColdRestore' in provider && typeof provider.ackColdRestore === 'function') {
      provider.ackColdRestore(args.id)
    }
  })

  // Why: renderer ACKs bound main→renderer delivery without stopping PTY ingestion — agent/status consumers still see every chunk via the provider/runtime path.
  ipcMain.removeAllListeners('pty:ackData')
  ipcMain.on(
    'pty:ackData',
    (event, args: { id: string; charCount?: number; processedChars?: number }) => {
      // Why optional: test drivers and synthetic replays invoke this without an event; only a real
      // renderer sender can be a stale previous owner.
      if (event?.sender && !isPtyOwnerWindowSender(session, event.sender, args.id)) {
        return
      }
      session.lastAckReceivedAtMs = Date.now()
      // Why: a live ACK channel means a future unanswered probe is a fresh diagnostic event, not a continuation of the last silent streak.
      session.deliveryResyncUnansweredWarnLogged = false
      let acknowledged = 0
      if (typeof args.processedChars === 'number' && Number.isFinite(args.processedChars)) {
        acknowledged = applyCumulativeAck(session, args.id, Math.max(0, args.processedChars))
      } else {
        // Why: tolerate legacy per-chunk delta payloads — dev hot-reload can pair an old renderer with a new main.
        const accounting = session.rendererDeliveryAccountingByPty.get(args.id)
        const delta = Number.isFinite(args.charCount) ? Math.max(0, args.charCount ?? 0) : 0
        acknowledged = accounting
          ? applyCumulativeAck(session, args.id, accounting.ackedChars + delta)
          : 0
      }
      tryGetProviderForPty(args.id)?.acknowledgeDataEvent(args.id, acknowledged)
      session.schedulePendingDataAfterCreditReport(acknowledged > 0)
    }
  )

  ipcMain.removeAllListeners('pty:deliveryResyncResponse')
  ipcMain.on(
    'pty:deliveryResyncResponse',
    (_event, args: { requestId: number; processedCharsByPty: Record<string, number> }) => {
      if (
        session.deliveryResyncOutstandingRequestId === null ||
        args?.requestId !== session.deliveryResyncOutstandingRequestId
      ) {
        return
      }
      session.clearDeliveryResyncProbe()
      session.deliveryResyncUnansweredWarnLogged = false
      // Why max-merge: the renderer's cumulative totals are authoritative for what it processed, draining exactly the in-flight debt from lost ACKs.
      let creditedAny = false
      for (const [id, processedChars] of Object.entries(args.processedCharsByPty ?? {})) {
        if (typeof processedChars !== 'number' || !Number.isFinite(processedChars)) {
          continue
        }
        const acknowledged = applyCumulativeAck(session, id, Math.max(0, processedChars))
        if (acknowledged > 0) {
          creditedAny = true
          tryGetProviderForPty(id)?.acknowledgeDataEvent(id, acknowledged)
        }
      }
      session.schedulePendingDataAfterCreditReport(creditedAny)
    }
  )
}
