import React, { useCallback, useEffect, useRef, useState } from 'react'
import { FolderTree, Server } from 'lucide-react'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import RepoBadgeLabel from '@/components/repo/RepoBadgeLabel'
import { searchRepos } from '@/lib/repo-search'
import type { Repo } from '../../../../shared/repo-types'
import { translate } from '@/i18n/i18n'
import type { ProjectGroupFilterOption } from './project-filter-selection'
import { SelectedProjectFilterChips } from './SidebarProjectFilterChips'
import { PROJECT_GROUP_HEADER_INDENT } from './worktree-list/rows/indentation'

function projectCommandFilter(_value: string, search: string, keywords?: string[]): number {
  const query = search.trim().toLowerCase()
  if (!query) {
    return 1
  }

  const [displayName = '', path = ''] = keywords ?? []
  const displayNameIndex = displayName.toLowerCase().indexOf(query)
  if (displayNameIndex !== -1) {
    return 2 + 1 / (displayNameIndex + 1)
  }

  const pathIndex = path.toLowerCase().indexOf(query)
  if (pathIndex !== -1) {
    return 1 + 1 / (pathIndex + 1)
  }

  return 0
}

const GROUP_VALUE_PREFIX = 'group:'
const REPO_VALUE_PREFIX = 'repo:'

function parseCommandValue(value: string): { kind: 'group' | 'repo'; id: string } | null {
  if (value.startsWith(GROUP_VALUE_PREFIX)) {
    return { kind: 'group', id: value.slice(GROUP_VALUE_PREFIX.length) }
  }
  if (value.startsWith(REPO_VALUE_PREFIX)) {
    return { kind: 'repo', id: value.slice(REPO_VALUE_PREFIX.length) }
  }
  return null
}

const PICKER_ITEM_CLASS =
  'mx-1 my-0.5 items-center gap-2 rounded-[7px] px-2 py-1 text-[12px] leading-5 font-medium data-[selected=true]:bg-black/8 dark:data-[selected=true]:bg-white/14'
const PICKER_GROUP_CLASS =
  'p-0 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-1.5 [&_[cmdk-group-heading]]:pb-0.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:uppercase'

type SidebarProjectFilterPanelProps = {
  availableRepos: Repo[]
  availableGroups: ProjectGroupFilterOption[]
  selectedRepos: Repo[]
  selectedGroups: ProjectGroupFilterOption[]
  hasRepoFilter: boolean
  onSelectRepo: (repoId: string) => void
  onRemoveRepo: (repoId: string) => void
  onSelectGroup: (groupId: string) => void
  onRemoveGroup: (groupId: string) => void
}

/**
 * Search + selection body of the Projects filter. Lives in its own component so
 * it mounts and unmounts with the submenu panel, which resets the query instead
 * of reopening onto a stale, pre-filtered list.
 */
export function SidebarProjectFilterPanel({
  availableRepos,
  availableGroups,
  selectedRepos,
  selectedGroups,
  hasRepoFilter,
  onSelectRepo,
  onRemoveRepo,
  onSelectGroup,
  onRemoveGroup
}: SidebarProjectFilterPanelProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [highlightedValue, setHighlightedValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Why: `autoFocus` cannot survive here — it fires during commit, while the
  // root menu's trapped focus scope is still active and yanks focus back to the
  // sub-trigger (the submenu only pauses that scope in a later passive effect).
  // A frame later both focus scopes have settled, so this focus sticks.
  useEffect(() => {
    const frame = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [])

  const selectRepo = useCallback(
    (repoId: string) => {
      onSelectRepo(repoId)
      setQuery('')
    },
    [onSelectRepo]
  )

  const selectGroup = useCallback(
    (groupId: string) => {
      onSelectGroup(groupId)
      setQuery('')
    },
    [onSelectGroup]
  )

  const handleInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      // Why: this command is embedded in a Radix dropdown; text keys should
      // stay in the search field instead of triggering menu typeahead.
      if (event.key === 'Backspace' && query === '') {
        // Why: chips render groups before projects, so the last project pick is the last chip.
        const lastRepo = selectedRepos.at(-1)
        const lastGroup = selectedGroups.at(-1)
        if (lastRepo) {
          event.preventDefault()
          event.stopPropagation()
          onRemoveRepo(lastRepo.id)
        } else if (lastGroup) {
          event.preventDefault()
          event.stopPropagation()
          onRemoveGroup(lastGroup.group.id)
        }
        return
      }

      if (event.key === 'Enter') {
        const highlighted = parseCommandValue(highlightedValue)
        if (
          highlighted?.kind === 'group' &&
          availableGroups.some((option) => option.group.id === highlighted.id)
        ) {
          event.preventDefault()
          event.stopPropagation()
          selectGroup(highlighted.id)
          return
        }
        const highlightedRepo =
          highlighted?.kind === 'repo'
            ? availableRepos.find((repo) => repo.id === highlighted.id)
            : undefined
        const repo = highlightedRepo ?? searchRepos(availableRepos, query)[0]
        if (repo) {
          event.preventDefault()
          event.stopPropagation()
          selectRepo(repo.id)
        }
        return
      }

      // Why: swallowing every ArrowLeft would trap keyboard users in the panel,
      // since that is the key Radix uses to step back to the parent menu. Only
      // claim it while the caret still has somewhere to move.
      if (event.key === 'ArrowLeft') {
        const { selectionStart, selectionEnd } = event.currentTarget
        const caretAtStart = selectionStart === 0 && selectionEnd === 0
        if (!caretAtStart) {
          event.stopPropagation()
        }
        return
      }

      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
        event.stopPropagation()
      }
    },
    [
      availableGroups,
      availableRepos,
      highlightedValue,
      onRemoveGroup,
      onRemoveRepo,
      query,
      selectGroup,
      selectRepo,
      selectedGroups,
      selectedRepos
    ]
  )

  const hasGroups = availableGroups.length > 0
  const repoItems = availableRepos.map((repo) => (
    <CommandItem
      key={repo.id}
      value={`${REPO_VALUE_PREFIX}${repo.id}`}
      keywords={[repo.displayName, repo.path]}
      onSelect={() => selectRepo(repo.id)}
      className={PICKER_ITEM_CLASS}
    >
      <span className="inline-flex min-w-0 flex-1 items-center gap-1.5">
        <RepoBadgeLabel name={repo.displayName} color={repo.badgeColor} className="max-w-full" />
        {repo.connectionId && (
          <span className="shrink-0 inline-flex items-center gap-0.5 rounded bg-muted px-1 py-0.5 text-[9px] font-medium leading-none text-muted-foreground">
            <Server className="size-2.5" />
            {translate('auto.components.sidebar.SidebarRepositoryFilterSection.2656053db4', 'SSH')}
          </span>
        )}
      </span>
    </CommandItem>
  ))

  return (
    <Command
      filter={projectCommandFilter}
      onValueChange={setHighlightedValue}
      className="bg-transparent"
    >
      <SelectedProjectFilterChips
        selectedGroups={selectedGroups}
        selectedRepos={selectedRepos}
        onRemoveGroup={onRemoveGroup}
        onRemoveRepo={onRemoveRepo}
      />
      <CommandInput
        ref={inputRef}
        placeholder={
          hasRepoFilter
            ? translate(
                'auto.components.sidebar.SidebarRepositoryFilterSection.5a273fbfce',
                'Add project...'
              )
            : translate(
                'auto.components.sidebar.SidebarRepositoryFilterSection.83a820fa71',
                'Filter projects...'
              )
        }
        value={query}
        onValueChange={setQuery}
        onKeyDown={handleInputKeyDown}
        className="h-8 py-2 text-xs"
        wrapperClassName="mx-1 rounded-[7px] border border-border/70 px-2"
        iconClassName="h-3.5 w-3.5"
      />
      <CommandList className="max-h-48 py-1">
        <CommandEmpty className="py-4 text-[11px]">
          {hasRepoFilter
            ? translate(
                'auto.components.sidebar.SidebarRepositoryFilterSection.bbbc6e8e3b',
                'No unselected projects match'
              )
            : translate(
                'auto.components.sidebar.SidebarRepositoryFilterSection.4815c70605',
                'No projects match'
              )}
        </CommandEmpty>
        {/* Why: headings only earn their space once groups exist; the flat list stays as it was. */}
        {hasGroups && (
          <CommandGroup
            heading={translate(
              'auto.components.sidebar.SidebarRepositoryFilterSection.groupsHeading',
              'Groups'
            )}
            className={PICKER_GROUP_CLASS}
          >
            {availableGroups.map((option) => (
              <ProjectGroupFilterItem
                key={option.group.id}
                option={option}
                onSelect={selectGroup}
              />
            ))}
          </CommandGroup>
        )}
        {hasGroups ? (
          <CommandGroup
            heading={translate(
              'auto.components.sidebar.SidebarRepositoryFilterSection.7679f0c268',
              'Projects'
            )}
            className={PICKER_GROUP_CLASS}
          >
            {repoItems}
          </CommandGroup>
        ) : (
          repoItems
        )}
      </CommandList>
    </Command>
  )
}

function ProjectGroupFilterItem({
  option,
  onSelect
}: {
  option: ProjectGroupFilterOption
  onSelect: (groupId: string) => void
}): React.JSX.Element {
  return (
    <CommandItem
      value={`${GROUP_VALUE_PREFIX}${option.group.id}`}
      keywords={[option.group.name]}
      onSelect={() => onSelect(option.group.id)}
      className={PICKER_ITEM_CLASS}
      // Why: same per-level step as the sidebar's group headers, so the picker reads as that tree.
      style={{ paddingLeft: 8 + option.depth * PROJECT_GROUP_HEADER_INDENT }}
    >
      <FolderTree className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{option.group.name}</span>
      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
        {option.repoCount}
      </span>
    </CommandItem>
  )
}
