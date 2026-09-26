import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { ALL_TUI_AGENTS, TUI_AGENT_DISPLAY_NAMES } from '../../../../shared/tui-agent-display-names'
import type { AgentLaunchVariant } from '../../../../shared/agent-launch-variants'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { TuiAgent } from '../../../../shared/tui-agent'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { SettingsSubsectionHeader } from './SettingsFormControls'
import { translate } from '@/i18n/i18n'
import { agentVariantActionId } from '../../../../shared/keybindings'
import { useAppStore } from '@/store'
import { toast } from 'sonner'

export function AgentLaunchVariantsSetting({
  settings,
  updateSettings
}: {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void | Promise<void>
}): React.JSX.Element {
  const variants = settings.agentLaunchVariants ?? []
  const clearVariantBinding = useAppStore((state) => state.removeKeybindingAction)
  const [drafts, setDrafts] = useState<Record<string, { name?: string; command?: string }>>({})
  const [name, setName] = useState('')
  const [agent, setAgent] = useState<TuiAgent>('claude')
  const [command, setCommand] = useState('')
  const save = (next: AgentLaunchVariant[]) => updateSettings({ agentLaunchVariants: next })
  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={translate('components.settings.agentLaunchVariants.title', 'Launch variants')}
        description={translate(
          'components.settings.agentLaunchVariants.description',
          'Save named commands for agents. Variants use the selected agent environment and always open in a terminal.'
        )}
      />
      <div className="space-y-2">
        {variants.map((variant) => (
          <div
            key={variant.id}
            className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-[minmax(8rem,1fr)_minmax(8rem,1fr)_minmax(12rem,2fr)_auto]"
          >
            <Input
              aria-label="Variant name"
              value={drafts[variant.id]?.name ?? variant.name}
              onChange={(event) =>
                setDrafts((current) => ({
                  ...current,
                  [variant.id]: { ...current[variant.id], name: event.target.value }
                }))
              }
              onBlur={() => {
                const value = drafts[variant.id]?.name?.trim()
                if (
                  !value ||
                  variants.some(
                    (entry) =>
                      entry.id !== variant.id && entry.name.toLowerCase() === value.toLowerCase()
                  )
                ) {
                  return
                }
                void save(
                  variants.map((entry) =>
                    entry.id === variant.id ? { ...entry, name: value } : entry
                  )
                )
              }}
            />
            <Select
              value={variant.agent}
              onValueChange={(value) =>
                save(
                  variants.map((entry) =>
                    entry.id === variant.id ? { ...entry, agent: value as TuiAgent } : entry
                  )
                )
              }
            >
              <SelectTrigger aria-label="Agent">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ALL_TUI_AGENTS.map((id) => (
                  <SelectItem key={id} value={id}>
                    {TUI_AGENT_DISPLAY_NAMES[id]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              aria-label="Launch command"
              value={drafts[variant.id]?.command ?? variant.command}
              onChange={(event) =>
                setDrafts((current) => ({
                  ...current,
                  [variant.id]: { ...current[variant.id], command: event.target.value }
                }))
              }
              onBlur={() => {
                const value = drafts[variant.id]?.command?.trim()
                if (!value) {
                  return
                }
                void save(
                  variants.map((entry) =>
                    entry.id === variant.id ? { ...entry, command: value } : entry
                  )
                )
              }}
            />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Delete ${variant.name}`}
              onClick={async () => {
                try {
                  await clearVariantBinding(agentVariantActionId(variant.id))
                  await save(variants.filter((entry) => entry.id !== variant.id))
                  setDrafts((current) => {
                    const { [variant.id]: _removed, ...rest } = current
                    return rest
                  })
                } catch {
                  toast.error('Could not delete launch variant.')
                }
              }}
            >
              <Trash2 />
            </Button>
          </div>
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-[minmax(8rem,1fr)_minmax(8rem,1fr)_minmax(12rem,2fr)_auto]">
        <Input
          aria-label="New variant name"
          placeholder="Name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <Select value={agent} onValueChange={(value) => setAgent(value as TuiAgent)}>
          <SelectTrigger aria-label="New variant agent">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ALL_TUI_AGENTS.map((id) => (
              <SelectItem key={id} value={id}>
                {TUI_AGENT_DISPLAY_NAMES[id]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          aria-label="New variant command"
          placeholder="Full launch command"
          value={command}
          onChange={(event) => setCommand(event.target.value)}
        />
        <Button
          size="sm"
          disabled={
            !name.trim() ||
            !command.trim() ||
            variants.some(
              (entry) => entry.name.toLocaleLowerCase() === name.trim().toLocaleLowerCase()
            )
          }
          onClick={() => {
            const id = globalThis.crypto.randomUUID()
            void save([...variants, { id, name: name.trim(), agent, command: command.trim() }])
            setName('')
            setCommand('')
          }}
        >
          <Plus /> Add
        </Button>
      </div>
    </section>
  )
}
