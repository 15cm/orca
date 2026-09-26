import { describe, expect, it } from 'vitest'
import type { KeybindingDefinition } from '../../../../shared/keybindings'
import type { ActivePluginCommand } from '@/store/plugin-panels'
import { buildShortcutDefinitionCatalog } from './shortcut-definition-catalog'
import { groupDefinitions } from './shortcut-groups'

const pluginDefinition: KeybindingDefinition = {
  id: 'plugin:orca-samples.tasks/open',
  title: 'Open Tasks — Tasks',
  group: 'Plugins',
  scope: 'global',
  searchKeywords: ['plugin', 'tasks'],
  defaultBindings: {
    darwin: ['Mod+Alt+T'],
    linux: ['Mod+Alt+T'],
    win32: ['Mod+Alt+T']
  }
}

describe('shortcut groups', () => {
  it('includes dynamic plugin command definitions in Settings', () => {
    expect(groupDefinitions([], [pluginDefinition])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: 'Plugins',
          items: [pluginDefinition]
        })
      ])
    )
  })

  it('adds shortcuts for enabled launch variants and omits disabled agents', () => {
    const variants = [
      { id: 'fast', name: 'Fast mode', agent: 'claude' as const, command: 'claude --fast' },
      { id: 'quiet', name: 'Quiet mode', agent: 'codex' as const, command: 'codex -q' }
    ]
    const groups = groupDefinitions(['codex'], [], variants)
    const agents = groups.find((group) => group.title === 'Agents')?.items ?? []
    expect(agents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'tab.newAgentVariant.fast', title: 'New Fast mode tab' })
      ])
    )
    expect(agents.some((item) => item.id === 'tab.newAgentVariant.quiet')).toBe(false)
  })

  it('exposes the agent dashboard toggle as a customizable Global row', () => {
    const global = groupDefinitions([]).find((group) => group.title === 'Global')

    expect(global?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'dashboard.toggle', title: 'Toggle Agent Dashboard' })
      ])
    )
  })

  it('reports a plugin default that shadows a built-in shortcut', () => {
    const command: ActivePluginCommand = {
      pluginKey: 'orca-samples.tasks',
      pluginName: 'Tasks',
      id: 'open',
      title: 'Open Tasks',
      context: 'global',
      handler: { type: 'built-in', action: 'view.tasks' },
      keybindings: [{ key: 'Mod+P', when: 'global' }]
    }

    const catalog = buildShortcutDefinitionCatalog({
      disabledTuiAgents: [],
      pluginCommands: [command],
      keybindings: {},
      platform: 'darwin',
      missionControlConflictMessage: 'Blocked by Mission Control.'
    })

    expect(catalog.conflictByAction.get('plugin:orca-samples.tasks/open')).toEqual([
      expect.stringContaining('Go to File')
    ])
  })
})
