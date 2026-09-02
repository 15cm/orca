import { toast } from 'sonner'
import type { ExecutionHostId } from '../../../../shared/execution-host'

const pendingCloses = new Map<string, Promise<void>>()

export function persistTerminalTabClose(args: {
  worktreeId: string
  tabId: string
  executionHostId: ExecutionHostId
  confirmed: boolean
  onClosed: () => void
  onPinned: () => void
  onError: (error: unknown) => void
}): boolean {
  const sessionApi = (globalThis as { window?: { api?: typeof window.api } }).window?.api?.session
  if (typeof sessionApi?.closeTerminalTab !== 'function') {
    return false
  }
  const pendingKey = `${args.worktreeId}\0${args.tabId}`
  if (pendingCloses.has(pendingKey)) {
    return true
  }
  const pending = sessionApi
    .closeTerminalTab(
      { worktreeId: args.worktreeId, tabId: args.tabId, confirmed: args.confirmed },
      args.executionHostId
    )
    .then((result) => (result.pinned ? args.onPinned() : args.onClosed()))
    .catch((error: unknown) => {
      toast.error('Failed to persist terminal close')
      args.onError(error)
    })
    .finally(() => pendingCloses.delete(pendingKey))
  pendingCloses.set(pendingKey, pending)
  return true
}
