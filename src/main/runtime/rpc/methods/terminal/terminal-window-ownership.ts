import type { OrcaRuntimeService } from '../../../orca-runtime'

/** Refuses a desktop-IPC terminal mutation coming from a window that does not own it.
 *  `senderWindowId` is undefined for socket/mobile callers, which stay unscoped. */
export function assertSenderOwnsTerminal(
  runtime: OrcaRuntimeService,
  terminal: string,
  senderWindowId: number | undefined
): void {
  if (
    senderWindowId !== undefined &&
    !runtime.senderWindowOwnsTerminalHandle(terminal, senderWindowId)
  ) {
    throw new Error('runtime_unavailable')
  }
}
