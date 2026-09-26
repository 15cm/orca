import { isTuiAgent } from './tui-agent-config'
import type { TuiAgent } from './tui-agent'

export type AgentLaunchVariant = {
  id: string
  name: string
  agent: TuiAgent
  command: string
}

export function normalizeAgentLaunchVariants(value: unknown): AgentLaunchVariant[] {
  if (!Array.isArray(value)) {
    return []
  }
  const seenIds = new Set<string>()
  const seenNames = new Set<string>()
  const variants: AgentLaunchVariant[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      continue
    }
    const candidate = item as Record<string, unknown>
    const id = typeof candidate.id === 'string' ? candidate.id.trim() : ''
    const name = typeof candidate.name === 'string' ? candidate.name.trim() : ''
    const command = typeof candidate.command === 'string' ? candidate.command.trim() : ''
    if (
      !/^[a-zA-Z0-9-]{1,80}$/.test(id) ||
      !name ||
      !command ||
      !isTuiAgent(candidate.agent) ||
      seenIds.has(id) ||
      seenNames.has(name.toLowerCase())
    ) {
      continue
    }
    seenIds.add(id)
    seenNames.add(name.toLowerCase())
    variants.push({ id, name, agent: candidate.agent, command })
  }
  return variants
}
