import { randomUUID } from 'node:crypto'
import { getPtyIpc } from '../../pty-host-bindings'
import { parseTerminalKittyKeyboardFlags } from '../../../../shared/terminal-kitty-keyboard-flags'
import { isMainWindowPtyIpcEvent } from './write-input'
import { getPtyRendererWindow } from '../delivery/owner-window'
import type { PtyIpcSession, SerializeResult } from '../session'

export function settleSerializeRequest(
  session: PtyIpcSession,
  requestId: string,
  result: SerializeResult
): void {
  const pending = session.pendingSerializeRequests.get(requestId)
  if (!pending) {
    return
  }
  clearTimeout(pending.timeout)
  session.pendingSerializeRequests.delete(requestId)
  pending.resolve(result)
}

export function installPtySerializeBufferIpc(session: PtyIpcSession): void {
  const ipcMain = getPtyIpc()
  // Why: one persistent listener with a request-ID dispatch table instead of one per call, so concurrent serialize requests don't trip Node's MaxListeners=10 warning.
  ipcMain.on(
    'pty:serializeBuffer:response',
    (
      event,
      args: {
        requestId?: string
        snapshot?: {
          data?: unknown
          cols?: unknown
          rows?: unknown
          seq?: unknown
          lastTitle?: unknown
          kittyKeyboardFlags?: unknown
        } | null
      }
    ) => {
      // Why: the snapshot seeds terminal restore state, so only the main window may settle it.
      if (!isMainWindowPtyIpcEvent(event) || typeof args?.requestId !== 'string') {
        return
      }
      const snapshot = args.snapshot
      if (
        snapshot &&
        typeof snapshot.data === 'string' &&
        typeof snapshot.cols === 'number' &&
        typeof snapshot.rows === 'number'
      ) {
        const result: {
          data: string
          cols: number
          rows: number
          seq?: number
          lastTitle?: string
          kittyKeyboardFlags?: number
        } = {
          data: snapshot.data,
          cols: snapshot.cols,
          rows: snapshot.rows
        }
        if (typeof snapshot.seq === 'number' && Number.isFinite(snapshot.seq)) {
          result.seq = snapshot.seq
        }
        if (typeof snapshot.lastTitle === 'string' && snapshot.lastTitle.length > 0) {
          result.lastTitle = snapshot.lastTitle
        }
        // Why gated on seq: without a boundary the flags cannot be reconciled
        // against live bytes, so they prove nothing.
        const kittyKeyboardFlags = parseTerminalKittyKeyboardFlags(snapshot.kittyKeyboardFlags)
        if (result.seq !== undefined && kittyKeyboardFlags !== undefined) {
          result.kittyKeyboardFlags = kittyKeyboardFlags
        }
        settleSerializeRequest(session, args.requestId, result)
      } else {
        settleSerializeRequest(session, args.requestId, null)
      }
    }
  )
}

export function requestSerializedBuffer(
  session: PtyIpcSession,
  ptyId: string,
  opts?: { scrollbackRows?: number }
): Promise<SerializeResult> {
  // Why the owner window and not the session's: the buffer lives in the renderer that renders
  // this pane, so asking any other window returns nothing and the request just times out.
  const rendererWindow = getPtyRendererWindow(session, ptyId)
  if (!rendererWindow) {
    return Promise.resolve(null)
  }

  const requestId = randomUUID()
  return new Promise<SerializeResult>((resolve) => {
    const timeout = setTimeout(() => {
      settleSerializeRequest(session, requestId, null)
    }, 750)
    session.pendingSerializeRequests.set(requestId, { resolve, timeout })
    const payload: {
      requestId: string
      ptyId: string
      opts?: { scrollbackRows?: number }
    } = { requestId, ptyId }
    if (opts) {
      payload.opts = opts
    }
    rendererWindow.webContents.send('pty:serializeBuffer:request', payload)
  })
}
