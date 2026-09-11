import React from 'react'
import { FolderTree, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import RepoBadgeLabel from '@/components/repo/RepoBadgeLabel'
import type { Repo } from '../../../../shared/repo-types'
import { translate } from '@/i18n/i18n'
import type { ProjectGroupFilterOption } from './project-filter-selection'

type SelectedProjectFilterChipsProps = {
  selectedGroups: readonly ProjectGroupFilterOption[]
  selectedRepos: readonly Repo[]
  onRemoveGroup: (groupId: string) => void
  onRemoveRepo: (repoId: string) => void
}

/** Current picks of the Projects filter; a group is one chip, however many projects it admits. */
export function SelectedProjectFilterChips({
  selectedGroups,
  selectedRepos,
  onRemoveGroup,
  onRemoveRepo
}: SelectedProjectFilterChipsProps): React.JSX.Element | null {
  if (selectedGroups.length === 0 && selectedRepos.length === 0) {
    return null
  }

  return (
    <div className="scrollbar-sleek mx-1 mb-1 flex max-h-16 flex-wrap gap-1 overflow-y-auto rounded-[7px] border border-border/70 bg-muted/25 p-1">
      {selectedGroups.map(({ group }) => (
        <FilterChip
          key={`group:${group.id}`}
          label={group.name}
          onRemove={() => onRemoveGroup(group.id)}
        >
          <FolderTree className="size-3 shrink-0 text-muted-foreground" />
          <span className="max-w-[8rem] truncate">{group.name}</span>
        </FilterChip>
      ))}
      {selectedRepos.map((repo) => (
        <FilterChip
          key={`repo:${repo.id}`}
          label={repo.displayName}
          onRemove={() => onRemoveRepo(repo.id)}
        >
          <RepoBadgeLabel
            name={repo.displayName}
            color={repo.badgeColor}
            className="max-w-[8rem]"
            badgeClassName="size-1.5"
          />
        </FilterChip>
      ))}
    </div>
  )
}

function FilterChip({
  label,
  onRemove,
  children
}: {
  label: string
  onRemove: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Badge
      variant="outline"
      className="h-5 max-w-full gap-1 border-border/70 bg-background px-1.5 py-0 text-[11px] font-medium"
    >
      {children}
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={translate(
          'auto.components.sidebar.SidebarRepositoryFilterSection.f10ca29601',
          'Remove {{value0}} filter',
          { value0: label }
        )}
        className="-mr-1 size-4 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
        onMouseDown={(event) => event.preventDefault()}
        onClick={onRemove}
      >
        <X className="size-2.5" strokeWidth={2.5} />
      </Button>
    </Badge>
  )
}
