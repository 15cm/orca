import type { AppState } from '@/store'
import type { TerminalTabRetirementPlan } from '@/store/slices/terminal-tab-retirement'

export type PrecomputedTerminalCloseState = {
  owningWorktreeId: string
  terminalCountBeforeClose: number
  nextTerminalTabId: string | null
}

export type TerminalCloseTarget = {
  worktreeId: string
  terminalTabId: string
}

export function validatePrecomputedTerminalCloseState(
  tabId: string,
  retirementPlan: TerminalTabRetirementPlan | undefined,
  closeState: PrecomputedTerminalCloseState | undefined,
  worktreeId?: string
): PrecomputedTerminalCloseState | undefined {
  return retirementPlan?.tabId === tabId &&
    retirementPlan.worktreeId === closeState?.owningWorktreeId &&
    (worktreeId === undefined || worktreeId === closeState?.owningWorktreeId)
    ? closeState
    : undefined
}

export function resolveTerminalCloseTarget(
  state: Pick<AppState, 'tabsByWorktree' | 'unifiedTabsByWorktree'>,
  tabId: string,
  precomputed: PrecomputedTerminalCloseState | undefined,
  worktreeId?: string
): TerminalCloseTarget | null {
  if (precomputed) {
    if (worktreeId !== undefined && precomputed.owningWorktreeId !== worktreeId) {
      return null
    }
    return { worktreeId: precomputed.owningWorktreeId, terminalTabId: tabId }
  }
  const worktreeEntries =
    worktreeId === undefined
      ? Object.entries(state.tabsByWorktree)
      : [[worktreeId, state.tabsByWorktree[worktreeId] ?? []] as const]
  for (const [candidateWorktreeId, worktreeTabs] of worktreeEntries) {
    if (worktreeTabs.some((tab) => tab.id === tabId)) {
      return { worktreeId: candidateWorktreeId, terminalTabId: tabId }
    }
  }
  const unifiedEntries =
    worktreeId === undefined
      ? Object.entries(state.unifiedTabsByWorktree ?? {})
      : [[worktreeId, state.unifiedTabsByWorktree?.[worktreeId] ?? []] as const]
  for (const [candidateWorktreeId, unifiedTabs] of unifiedEntries) {
    const unified = unifiedTabs.find(
      (tab) => tab.contentType === 'terminal' && (tab.entityId === tabId || tab.id === tabId)
    )
    if (unified) {
      return { worktreeId: candidateWorktreeId, terminalTabId: unified.entityId }
    }
  }
  return null
}

// Why: host-backed terminals may exist only in unified state, so sibling
// selection must merge both representations into one terminal entity set.
export function getWorktreeTerminalTabIds(
  state: Pick<AppState, 'tabsByWorktree' | 'unifiedTabsByWorktree'>,
  worktreeId: string
): string[] {
  const ids = new Set<string>()
  for (const tab of state.tabsByWorktree[worktreeId] ?? []) {
    ids.add(tab.id)
  }
  for (const tab of state.unifiedTabsByWorktree?.[worktreeId] ?? []) {
    if (tab.contentType === 'terminal') {
      ids.add(tab.entityId)
    }
  }
  return [...ids]
}
