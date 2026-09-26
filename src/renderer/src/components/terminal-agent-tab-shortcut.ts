import {
  agentVariantActionId,
  type KeybindingActionId,
  type KeybindingOverrides
} from '../../../shared/keybindings'
import type { TuiAgent } from '../../../shared/tui-agent'
import { useAppStore } from '../store'
import { getConnectionId } from '../lib/connection-context'
import { listBoundAgentTabActions, resolveDefaultAgentForNewTab } from '@/lib/agent-tab-shortcuts'
import { isTuiAgentEnabled } from '../../../shared/tui-agent-selection'
import {
  getAgentDetectionTargetKeyForWorktree,
  parseAgentDetectionTargetKey
} from '@/hooks/useAgentDetectionTarget'

export type TerminalAgentTabShortcut = {
  actionId: KeybindingActionId | null
  agent: TuiAgent | null
  command?: string
}

export function resolveTerminalAgentTabShortcut({
  activeWorktreeId,
  keybindings,
  matchShortcut
}: {
  activeWorktreeId: string
  keybindings: KeybindingOverrides
  matchShortcut: (actionId: KeybindingActionId) => boolean
}): TerminalAgentTabShortcut {
  const state = useAppStore.getState()
  if (matchShortcut('tab.newAgent')) {
    const connectionId = getConnectionId(activeWorktreeId)
    return {
      actionId: 'tab.newAgent',
      agent: resolveDefaultAgentForNewTab({
        defaultTuiAgent: state.settings?.defaultTuiAgent,
        detectedAgentIds:
          typeof connectionId === 'string'
            ? state.remoteDetectedAgentIds[connectionId]
            : state.detectedAgentIds,
        disabledTuiAgents: state.settings?.disabledTuiAgents
      })
    }
  }
  for (const bound of listBoundAgentTabActions(keybindings, state.settings?.disabledTuiAgents)) {
    if (matchShortcut(bound.actionId)) {
      return { actionId: bound.actionId, agent: bound.agent }
    }
  }
  const detectionTarget = parseAgentDetectionTargetKey(
    getAgentDetectionTargetKeyForWorktree(state, activeWorktreeId)
  )
  const detected =
    detectionTarget?.kind === 'ssh'
      ? state.remoteDetectedAgentIds[detectionTarget.connectionId]
      : detectionTarget?.kind === 'runtime'
        ? state.runtimeDetectedAgentIds[detectionTarget.environmentId]
        : detectionTarget?.kind === 'local' && detectionTarget.contextKey
          ? state.localDetectedAgentIdsByContext[detectionTarget.contextKey]
          : state.detectedAgentIds
  for (const variant of state.settings?.agentLaunchVariants ?? []) {
    if (
      !detected?.includes(variant.agent) ||
      !isTuiAgentEnabled(variant.agent, state.settings?.disabledTuiAgents)
    ) {
      continue
    }
    const actionId = agentVariantActionId(variant.id)
    if (matchShortcut(actionId)) {
      return { actionId, agent: variant.agent, command: variant.command }
    }
  }
  return { actionId: null, agent: null }
}
