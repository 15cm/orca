import React, { useMemo, useState } from 'react'
import { Check, Server } from 'lucide-react'
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import RepoBadgeLabel from '@/components/repo/RepoBadgeLabel'
import { searchRepos } from '@/lib/repo-search'
import type { Repo } from '../../../../shared/repo-types'
import { translate } from '@/i18n/i18n'

const PICKER_BUTTON_CLASS =
  'rounded-full px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-40 disabled:hover:bg-transparent'

type SidebarFilterProjectPickerProps = {
  repos: readonly Repo[]
  selectedRepoIdSet: ReadonlySet<string>
  effectiveRepoCount: number
  hasRepoFilter: boolean
  allSelected: boolean
  onToggleRepo: (repoId: string) => void
  onSelectAll: () => void
  onClear: () => void
}

/**
 * The searchable project checklist of the workspace-board filter menu. Owns its query so it
 * resets with the menu (the content unmounts on close) instead of reopening pre-filtered.
 */
export function SidebarFilterProjectPicker({
  repos,
  selectedRepoIdSet,
  effectiveRepoCount,
  hasRepoFilter,
  allSelected,
  onToggleRepo,
  onSelectAll,
  onClear
}: SidebarFilterProjectPickerProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [commandValueOverride, setCommandValueOverride] = useState<string | null>(null)
  const filteredRepos = useMemo(() => searchRepos(repos, query), [repos, query])
  const commandValue =
    commandValueOverride && filteredRepos.some((repo) => repo.id === commandValueOverride)
      ? commandValueOverride
      : (filteredRepos[0]?.id ?? '')

  return (
    <>
      <div className="flex items-center justify-between px-2 py-1">
        <span className="text-[11px] font-semibold tracking-wide uppercase text-muted-foreground">
          {translate('auto.components.sidebar.SidebarFilter.5f7085a077', 'Projects')}
          {hasRepoFilter && (
            <span className="ml-1.5 normal-case tracking-normal font-medium text-foreground">
              · {effectiveRepoCount}
            </span>
          )}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onSelectAll}
            className={PICKER_BUTTON_CLASS}
            disabled={allSelected}
          >
            {translate('auto.components.sidebar.SidebarFilter.139877b384', 'Select all')}
          </button>
          <button
            type="button"
            onClick={onClear}
            className={PICKER_BUTTON_CLASS}
            disabled={!hasRepoFilter}
          >
            {translate('auto.components.sidebar.SidebarFilter.779b7ba05d', 'Clear')}
          </button>
        </div>
      </div>

      <Command
        shouldFilter={false}
        value={commandValue}
        onValueChange={setCommandValueOverride}
        className="bg-transparent"
      >
        <CommandInput
          autoFocus
          placeholder={translate(
            'auto.components.sidebar.SidebarFilter.489d1c8c9f',
            'Search projects...'
          )}
          value={query}
          onValueChange={(nextQuery) => {
            // Why: typing creates a new filtered list, so keyboard
            // selection should return to the derived first match.
            setCommandValueOverride(null)
            setQuery(nextQuery)
          }}
          onKeyDown={(event) => event.stopPropagation()}
          className="h-8 py-2 text-xs"
          wrapperClassName="mx-1 rounded-[7px] border border-border/70 px-2"
          iconClassName="h-3.5 w-3.5"
        />
        <CommandList className="max-h-64 py-1">
          <CommandEmpty className="py-4 text-[11px]">
            {translate('auto.components.sidebar.SidebarFilter.b9e8802e73', 'No projects match')}
          </CommandEmpty>
          {filteredRepos.map((r) => {
            const checked = selectedRepoIdSet.has(r.id)
            return (
              <CommandItem
                key={r.id}
                value={r.id}
                onSelect={() => onToggleRepo(r.id)}
                className="mx-1 my-0.5 items-center gap-2 rounded-[7px] px-2 py-1 text-[12px] leading-5 font-medium data-[selected=true]:bg-black/8 dark:data-[selected=true]:bg-white/14"
              >
                <span className="inline-flex min-w-0 flex-1 items-center gap-1.5">
                  <RepoBadgeLabel
                    name={r.displayName}
                    color={r.badgeColor}
                    className="max-w-full"
                  />
                  {r.connectionId && (
                    <span className="shrink-0 inline-flex items-center gap-0.5 rounded bg-muted px-1 py-0.5 text-[9px] font-medium leading-none text-muted-foreground">
                      <Server className="size-2.5" />
                      {translate('auto.components.sidebar.SidebarFilter.81ded53722', 'SSH')}
                    </span>
                  )}
                </span>
                {checked && <Check className="size-3 shrink-0 text-primary" strokeWidth={3} />}
              </CommandItem>
            )
          })}
        </CommandList>
      </Command>
    </>
  )
}
