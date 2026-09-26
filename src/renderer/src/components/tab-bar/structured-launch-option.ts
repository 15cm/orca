import type { ActiveOption } from './tab-create-entry-active-option'
import { isAgentSessionHandleProvider } from '../../../../shared/agent-session-provider-handle'
import type { TuiAgent } from '../../../../shared/tui-agent'
import type { StructuredAgentLaunchStatus } from '@/lib/structured-agent-session-launch'

type StructuredLaunchStatuses = Record<'claude' | 'codex', StructuredAgentLaunchStatus>

export function optionHasPendingStructuredLaunch(
  option: ActiveOption,
  statuses: StructuredLaunchStatuses
): boolean {
  if (option.kind !== 'agent' || option.option.variantId) {
    return false
  }
  const agent = option.option.agent as TuiAgent
  return isAgentSessionHandleProvider(agent) && statuses[agent as 'claude' | 'codex'] === 'pending'
}
