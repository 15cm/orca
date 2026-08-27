import { useAppStore } from '@/store'
import type {
  TerminalTabCloseReason,
  TerminalTabRetirementPlan
} from '@/store/slices/terminal-tab-retirement'

export function closeLocalTerminalTabState(
  terminalTabId: string,
  options?: {
    worktreeId?: string
    reason?: TerminalTabCloseReason
    captureRecentlyClosed?: boolean
    remoteCloseOwnedByHost?: boolean
    localPtyTeardownOwnedExternally?: boolean
    precomputedRetirementPlan?: TerminalTabRetirementPlan
  }
): void {
  const state = useAppStore.getState()
  const candidateTabs = options?.worktreeId
    ? [state.tabsByWorktree[options.worktreeId] ?? []]
    : Object.values(state.tabsByWorktree)
  if (
    options?.precomputedRetirementPlan?.tabId === terminalTabId ||
    candidateTabs.some((tabs) => tabs.some((tab) => tab.id === terminalTabId))
  ) {
    if (
      options?.reason ||
      options?.captureRecentlyClosed !== undefined ||
      options?.remoteCloseOwnedByHost ||
      options?.localPtyTeardownOwnedExternally ||
      options?.precomputedRetirementPlan
    ) {
      state.closeTab(terminalTabId, options)
    } else {
      state.closeTab(terminalTabId)
    }
    return
  }

  const unifiedTabs = options?.worktreeId
    ? [state.unifiedTabsByWorktree?.[options.worktreeId] ?? []]
    : Object.values(state.unifiedTabsByWorktree ?? {})
  for (const tabs of unifiedTabs) {
    const unified = tabs.find(
      (tab) =>
        tab.contentType === 'terminal' &&
        (tab.entityId === terminalTabId || tab.id === terminalTabId)
    )
    if (unified) {
      state.closeTab(unified.entityId, options)
      return
    }
  }
}
