import { useMemo } from 'react'
import { useAppStore } from '@/store'
import {
  buildProjectFilterSelection,
  type ProjectFilterSelection
} from './project-filter-selection'

export function useProjectFilterSelection(overrides?: {
  filterRepoIds?: readonly string[]
  filterGroupIds?: readonly string[]
}): ProjectFilterSelection {
  const repos = useAppStore((s) => s.repos)
  const projectGroups = useAppStore((s) => s.projectGroups)
  const storeFilterRepoIds = useAppStore((s) => s.filterRepoIds)
  const storeFilterGroupIds = useAppStore((s) => s.filterGroupIds)
  const filterRepoIds = overrides?.filterRepoIds ?? storeFilterRepoIds
  const filterGroupIds = overrides?.filterGroupIds ?? storeFilterGroupIds
  return useMemo(
    () => buildProjectFilterSelection({ repos, projectGroups, filterRepoIds, filterGroupIds }),
    [repos, projectGroups, filterRepoIds, filterGroupIds]
  )
}
