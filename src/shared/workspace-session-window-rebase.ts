/**
 * Rebases one window's session write onto the keys it does not own.
 *
 * The workspace session is a single object and every write replaces whole keyed maps
 * (`tabsByWorktree`, `unifiedTabs`, `tabGroups`…). With one window that is fine. With a project
 * window serving its own worktrees it is not: a plain write would erase every other window's
 * tabs from disk, and the next launch's with them.
 *
 * So a window that declares which worktrees it owns gets its write rebased — its keys are taken
 * from the incoming session, every other key is preserved from what is already stored. This is
 * the same partition the per-host split performs (`workspace-session-host-split.ts`), on the
 * window axis instead of the host axis, and it shares the key→worktree rule with it.
 */
import {
  WORKSPACE_SESSION_FIELD_OWNERSHIP,
  type WorkspaceSessionFieldOwnership
} from './workspace-session-field-ownership'
import {
  buildWorktreeIdByFileId,
  buildWorktreeIdByTabId,
  isWorkspaceSessionRecord,
  resolveWorkspaceSessionKeyWorktree,
  type WorkspaceSessionRecord
} from './workspace-session-key-resolution'
import { parseWorkspaceKey } from './workspace-scope'
import type { WorkspaceSessionState } from './workspace-session-state-types'

/** The worktrees a window writes for. A window that declares none is the shared writer. */
export type OwnedWorktreeIds = ReadonlySet<string>

const ACTIVE_FOCUS_FIELDS = new Set<keyof WorkspaceSessionState>([
  'activeWorktreeId',
  'activeWorkspaceKey',
  'activeRepoId',
  'activeWorkspaceExecutionHostId',
  'activeTabId'
])

function ownsKey(
  ownership: WorkspaceSessionFieldOwnership,
  key: string,
  value: unknown,
  owned: OwnedWorktreeIds,
  resolve: ReturnType<typeof resolveWorkspaceSessionKeyWorktree>
): boolean {
  if (ownership === 'worktreeKeyed') {
    return owned.has(key)
  }
  const worktreeId = resolve?.(key, value)
  // Why keep an unresolvable key with the shared writer: losing it is worse than a stale entry,
  // and only the shared window can be sure nothing else claims it.
  return worktreeId === undefined ? false : owned.has(worktreeId)
}

function rebaseRecordField(
  current: unknown,
  incoming: unknown,
  ownership: WorkspaceSessionFieldOwnership,
  owned: OwnedWorktreeIds,
  resolveCurrent: ReturnType<typeof resolveWorkspaceSessionKeyWorktree>,
  resolveIncoming: ReturnType<typeof resolveWorkspaceSessionKeyWorktree>
): WorkspaceSessionRecord {
  const out: WorkspaceSessionRecord = {}
  if (isWorkspaceSessionRecord(current)) {
    for (const [key, value] of Object.entries(current)) {
      // Keys this window does not own survive its write untouched.
      if (!ownsKey(ownership, key, value, owned, resolveCurrent)) {
        out[key] = value
      }
    }
  }
  if (isWorkspaceSessionRecord(incoming)) {
    for (const [key, value] of Object.entries(incoming)) {
      // A key the window owns takes the incoming value; one it does not is ignored, so a stale
      // read in a project window can never overwrite another window's entry.
      if (ownsKey(ownership, key, value, owned, resolveIncoming)) {
        out[key] = value
      }
    }
  }
  return out
}

function rebaseWorktreeArrayField(
  current: unknown,
  incoming: unknown,
  owned: OwnedWorktreeIds
): string[] {
  const kept = Array.isArray(current)
    ? (current as string[]).filter((worktreeId) => !owned.has(worktreeId))
    : []
  const mine = Array.isArray(incoming)
    ? (incoming as string[]).filter((worktreeId) => owned.has(worktreeId))
    : []
  return [...new Set([...kept, ...mine])]
}

/**
 * The active-focus fields name a workspace rather than describing the profile, so they follow the
 * window that serves it. Without this a project window hydrates its tabs with nothing selected.
 */
function assignActiveFocus(
  session: WorkspaceSessionState,
  owned: OwnedWorktreeIds,
  worktreeIdByTabId: Map<string, string>,
  ownedOut: WorkspaceSessionRecord,
  restOut: WorkspaceSessionRecord
): void {
  const activeWorktreeId = session.activeWorktreeId
  // A workspace key wraps a worktree id; unwrap it so a session that carries only the key still matches.
  const activeKey =
    typeof session.activeWorkspaceKey === 'string' ? session.activeWorkspaceKey : null
  const parsedKey = activeKey === null ? null : parseWorkspaceKey(activeKey)
  const activeKeyWorktreeId = parsedKey?.type === 'worktree' ? parsedKey.worktreeId : activeKey
  const focusIsOwned =
    (typeof activeWorktreeId === 'string' && owned.has(activeWorktreeId)) ||
    (activeKeyWorktreeId !== null && owned.has(activeKeyWorktreeId))
  const target = focusIsOwned ? ownedOut : restOut
  const other = focusIsOwned ? restOut : ownedOut
  for (const field of [
    'activeWorktreeId',
    'activeWorkspaceKey',
    'activeRepoId',
    'activeWorkspaceExecutionHostId'
  ] as const) {
    target[field] = session[field]
    other[field] = null
  }
  // The active tab follows its own worktree, which can differ from the active workspace.
  const activeTabId = session.activeTabId
  const activeTabWorktreeId =
    typeof activeTabId === 'string' ? worktreeIdByTabId.get(activeTabId) : undefined
  const tabTarget =
    activeTabWorktreeId !== undefined && owned.has(activeTabWorktreeId) ? ownedOut : restOut
  tabTarget.activeTabId = activeTabId ?? null
  ;(tabTarget === ownedOut ? restOut : ownedOut).activeTabId = null
}

/**
 * Splits a session in two along the window axis: the keys these worktrees own, and everything
 * else. Reading a project window is the `owned` half, reading the shared window is `rest`, and a
 * rebased write is `rest` of what is stored merged with `owned` of what came in — one traversal
 * behind all three.
 *
 * Global fields go to `rest`: they describe one window's focus and there is one slot for them.
 */
export function partitionWorkspaceSessionByWorktrees(
  session: WorkspaceSessionState,
  owned: OwnedWorktreeIds
): { owned: WorkspaceSessionState; rest: WorkspaceSessionState } {
  const resolveContext = {
    worktreeIdByTabId: buildWorktreeIdByTabId(session),
    worktreeIdByFileId: buildWorktreeIdByFileId(session)
  }
  const ownedOut: WorkspaceSessionRecord = {}
  const restOut: WorkspaceSessionRecord = {}
  for (const field of Object.keys(
    WORKSPACE_SESSION_FIELD_OWNERSHIP
  ) as (keyof WorkspaceSessionState)[]) {
    const ownership = WORKSPACE_SESSION_FIELD_OWNERSHIP[field]
    const value = session[field]
    if (value === undefined) {
      continue
    }
    if (ownership === 'global' || ownership === 'hostPrivate') {
      // Active focus is assigned below: it names a workspace, so it follows its owner.
      if (!ACTIVE_FOCUS_FIELDS.has(field)) {
        restOut[field] = value
      }
      continue
    }
    if (ownership === 'worktreeArray') {
      const ids = Array.isArray(value) ? (value as string[]) : []
      ownedOut[field] = ids.filter((worktreeId) => owned.has(worktreeId))
      restOut[field] = ids.filter((worktreeId) => !owned.has(worktreeId))
      continue
    }
    const resolve = resolveWorkspaceSessionKeyWorktree(ownership, resolveContext)
    const mine: WorkspaceSessionRecord = {}
    const theirs: WorkspaceSessionRecord = {}
    if (isWorkspaceSessionRecord(value)) {
      for (const [key, entry] of Object.entries(value)) {
        const target = ownsKey(ownership, key, entry, owned, resolve) ? mine : theirs
        target[key] = entry
      }
    }
    ownedOut[field] = mine
    restOut[field] = theirs
  }
  assignActiveFocus(session, owned, resolveContext.worktreeIdByTabId, ownedOut, restOut)
  return {
    owned: ownedOut as WorkspaceSessionState,
    rest: restOut as WorkspaceSessionState
  }
}

/**
 * `owned` empty means the caller is the shared writer and the incoming session wins whole —
 * the pre-window behavior, which is what an older renderer that sends no ownership still gets.
 */
export function rebaseWorkspaceSessionWrite(
  current: WorkspaceSessionState,
  incoming: WorkspaceSessionState,
  owned: OwnedWorktreeIds
): WorkspaceSessionState {
  if (owned.size === 0) {
    return incoming
  }
  const resolveContextCurrent = {
    worktreeIdByTabId: buildWorktreeIdByTabId(current),
    worktreeIdByFileId: buildWorktreeIdByFileId(current)
  }
  const resolveContextIncoming = {
    worktreeIdByTabId: buildWorktreeIdByTabId(incoming),
    worktreeIdByFileId: buildWorktreeIdByFileId(incoming)
  }
  const out = { ...current } as WorkspaceSessionRecord
  for (const field of Object.keys(
    WORKSPACE_SESSION_FIELD_OWNERSHIP
  ) as (keyof WorkspaceSessionState)[]) {
    const ownership = WORKSPACE_SESSION_FIELD_OWNERSHIP[field]
    switch (ownership) {
      case 'global':
      case 'hostPrivate':
        // Why the scoped window never writes these: `activeRepoId`, `activeTabId` and friends
        // describe one window's focus, and there is one slot for them.
        break
      case 'worktreeArray':
        out[field] = rebaseWorktreeArrayField(current[field], incoming[field], owned)
        break
      default:
        out[field] = rebaseRecordField(
          current[field],
          incoming[field],
          ownership,
          owned,
          resolveWorkspaceSessionKeyWorktree(ownership, resolveContextCurrent),
          resolveWorkspaceSessionKeyWorktree(ownership, resolveContextIncoming)
        )
        break
    }
  }
  return out as WorkspaceSessionState
}

/** Every worktree-keyed key present in a session — the candidates a window's scope selects from. */
export function collectWorkspaceSessionWorktreeKeys(session: WorkspaceSessionState): Set<string> {
  const keys = new Set<string>()
  for (const field of Object.keys(
    WORKSPACE_SESSION_FIELD_OWNERSHIP
  ) as (keyof WorkspaceSessionState)[]) {
    if (WORKSPACE_SESSION_FIELD_OWNERSHIP[field] !== 'worktreeKeyed') {
      continue
    }
    const value = session[field]
    if (isWorkspaceSessionRecord(value)) {
      for (const key of Object.keys(value)) {
        keys.add(key)
      }
    }
  }
  for (const worktreeId of session.activeWorktreeIdsOnShutdown ?? []) {
    keys.add(worktreeId)
  }
  return keys
}
