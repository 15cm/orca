import {
  getAgentRowGeneratedTitleText,
  getOrcaDispatchTaskId,
  isOrcaDispatchPrompt,
  orchestrationLabelsMatchLiveDispatch
} from '@/lib/agent-row-primary-text'
import type { AppState } from '../types'
import {
  agentStatusTabAlreadyHasProtectedOrGeneratedTitle,
  getTabIdFromPaneKey
} from './agent-status-pane-key-tab-binding'
import type { GeneratedTabTitleUpdate } from './terminal-tab-title-batch'

type GeneratedTitleProjectionState = Pick<
  AppState,
  'agentStatusByPaneKey' | 'tabsByWorktree' | 'settings'
>

/** Projects recorded status prompts into title writes after title settings hydrate. */
export function projectMissingGeneratedTabTitlesFromAgentStatuses(
  state: GeneratedTitleProjectionState
): GeneratedTabTitleUpdate[] {
  if (state.settings?.tabAutoGenerateTitle !== true) {
    return []
  }
  const updates: GeneratedTabTitleUpdate[] = []
  const seenPaneKeys = new Set<string>()
  for (const [paneKey, entry] of Object.entries(state.agentStatusByPaneKey)) {
    if (seenPaneKeys.has(paneKey) || !entry.prompt?.trim()) {
      continue
    }
    const tabId = entry.tabId ?? getTabIdFromPaneKey(paneKey)
    const hasMatchingOrchestrationLabels = Boolean(
      (entry.orchestration?.displayName?.trim() || entry.orchestration?.taskTitle?.trim()) &&
      orchestrationLabelsMatchLiveDispatch(entry)
    )
    const liveIsDispatchPrompt = isOrcaDispatchPrompt(entry.prompt)
    const liveDispatchTaskId = liveIsDispatchPrompt ? getOrcaDispatchTaskId(entry.prompt) : null
    const stickyOrchestrationTaskId = entry.orchestration?.taskId?.trim() || null
    const shouldReplaceGeneratedTitle = Boolean(
      hasMatchingOrchestrationLabels ||
      (liveDispatchTaskId &&
        stickyOrchestrationTaskId &&
        liveDispatchTaskId !== stickyOrchestrationTaskId)
    )
    if (
      !tabId ||
      agentStatusTabAlreadyHasProtectedOrGeneratedTitle(state, tabId, entry.worktreeId)
    ) {
      continue
    }
    seenPaneKeys.add(paneKey)
    updates.push({
      paneKey,
      prompt: liveIsDispatchPrompt ? getAgentRowGeneratedTitleText(entry) : entry.prompt,
      ...(shouldReplaceGeneratedTitle ? { options: { replaceExistingGeneratedTitle: true } } : {})
    })
  }
  return updates
}
