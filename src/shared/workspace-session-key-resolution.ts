import type { WorkspaceSessionState } from './workspace-session-state-types'

export type WorkspaceSessionRecord = Record<string, unknown>

export function isWorkspaceSessionRecord(value: unknown): value is WorkspaceSessionRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function buildWorktreeIdByTabId(state: WorkspaceSessionState): Map<string, string> {
  const byTab = new Map<string, string>()
  for (const [worktreeId, tabs] of Object.entries(state.tabsByWorktree ?? {})) {
    for (const tab of tabs) {
      byTab.set(tab.id, worktreeId)
    }
  }
  // Why: unified-only tabs still need their host-owned layout and PTY records routed correctly.
  for (const tabs of Object.values(state.unifiedTabs ?? {})) {
    for (const tab of tabs) {
      if (!byTab.has(tab.id)) {
        byTab.set(tab.id, tab.worktreeId)
      }
    }
  }
  return byTab
}

export function buildWorktreeIdByFileId(state: WorkspaceSessionState): Map<string, string> {
  const byFile = new Map<string, string>()
  for (const files of Object.values(state.openFilesByWorktree ?? {})) {
    for (const file of files) {
      byFile.set(file.filePath, file.worktreeId)
    }
  }
  return byFile
}

export function mergeWorkspaceSessionRecordField(
  out: WorkspaceSessionRecord,
  field: keyof WorkspaceSessionState,
  slice: WorkspaceSessionState
): void {
  const value = slice[field]
  if (!isWorkspaceSessionRecord(value)) {
    return
  }
  const target = (out[field] ??= {}) as WorkspaceSessionRecord
  Object.assign(target, value)
}

export function mergeWorkspaceSessionArrayField(
  out: WorkspaceSessionRecord,
  field: keyof WorkspaceSessionState,
  slice: WorkspaceSessionState
): void {
  const value = slice[field]
  if (!Array.isArray(value)) {
    return
  }
  const target = (out[field] ??= []) as unknown[]
  target.push(...value)
}

/**
 * Resolves which worktree owns one entry of a keyed session field.
 *
 * `null` means the key itself carries the answer — `worktreeKeyed` maps and `worktreeArray`
 * entries are worktree ids already. Every other keyed field routes through a record it has to
 * look inside, and both partition axes (per host, per window) must agree on that answer, so this
 * is the single copy of the rule.
 */
export type WorkspaceSessionKeyWorktreeResolver = (
  key: string,
  value: unknown
) => string | undefined

export type WorkspaceSessionKeyResolutionContext = {
  worktreeIdByTabId: Map<string, string>
  worktreeIdByFileId: Map<string, string>
}

export function resolveWorkspaceSessionKeyWorktree(
  ownership: string,
  ctx: WorkspaceSessionKeyResolutionContext
): WorkspaceSessionKeyWorktreeResolver | null {
  switch (ownership) {
    case 'tabKeyed':
      return (tabId) => ctx.worktreeIdByTabId.get(tabId)
    case 'fileKeyed':
      return (fileId) => ctx.worktreeIdByFileId.get(fileId)
    case 'browserWorkspaceKeyed':
      return (_workspaceId, pages) => {
        const first = Array.isArray(pages)
          ? (pages[0] as { worktreeId?: string } | undefined)
          : undefined
        return first?.worktreeId
      }
    case 'sleepingAgentKeyed':
    case 'surfaceTombstoneKeyed':
      return (_key, record) =>
        isWorkspaceSessionRecord(record) && typeof record.worktreeId === 'string'
          ? record.worktreeId
          : undefined
    case 'paneKeyed':
      // Pane keys are `<tabId>:<paneId>`; the tab carries the worktree.
      return (paneKey) => {
        const separator = paneKey.lastIndexOf(':')
        return separator > 0 ? ctx.worktreeIdByTabId.get(paneKey.slice(0, separator)) : undefined
      }
    default:
      return null
  }
}
