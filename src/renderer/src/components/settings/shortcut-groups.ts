import {
  KEYBINDING_DEFINITIONS,
  agentTabActionId,
  type KeybindingActionId,
  type KeybindingDefinition
} from '../../../../shared/keybindings'
import { normalizeDisabledTuiAgents } from '../../../../shared/tui-agent-selection'
import type { TuiAgent } from '../../../../shared/tui-agent'
import { agentVariantActionId } from '../../../../shared/keybindings'
import type { AgentLaunchVariant } from '../../../../shared/agent-launch-variants'

export type ShortcutGroup = {
  title: string
  items: KeybindingDefinition[]
}

export const EMPTY_DISABLED_TUI_AGENTS: readonly TuiAgent[] = []

export function disabledAgentTabActionIds(
  disabledTuiAgents: readonly TuiAgent[]
): KeybindingActionId[] {
  return normalizeDisabledTuiAgents(disabledTuiAgents).map((agent) => agentTabActionId(agent))
}

export function groupDefinitions(
  disabledTuiAgents: readonly TuiAgent[],
  additionalDefinitions: readonly KeybindingDefinition[] = [],
  variants: readonly AgentLaunchVariant[] = []
): ShortcutGroup[] {
  // Why: per-agent launch rows only make sense for agents the user keeps
  // enabled in Settings → Agents; hiding disabled ones keeps the Agents group
  // scoped to what the chord could actually launch.
  const hiddenAgentActionIds = new Set<KeybindingActionId>(
    disabledAgentTabActionIds(disabledTuiAgents)
  )
  const groups = new Map<string, KeybindingDefinition[]>()
  const variantDefinitions: KeybindingDefinition[] = variants
    .filter((variant) => !disabledTuiAgents.includes(variant.agent))
    .map((variant) => ({
      id: agentVariantActionId(variant.id),
      title: `New ${variant.name} tab`,
      group: 'Agents',
      scope: 'tabs',
      searchKeywords: ['agent', 'variant', 'tab', variant.name, variant.agent],
      defaultBindings: { darwin: [], linux: [], win32: [] }
    }))
  for (const definition of [
    ...KEYBINDING_DEFINITIONS,
    ...additionalDefinitions,
    ...variantDefinitions
  ]) {
    if (hiddenAgentActionIds.has(definition.id)) {
      continue
    }
    groups.set(definition.group, [...(groups.get(definition.group) ?? []), definition])
  }
  return Array.from(groups.entries()).map(([title, items]) => ({ title, items }))
}
