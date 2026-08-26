import { useMemo } from 'react'
import { useAppStore } from '@/store'
import type { ProjectGroup } from '../../../../shared/project-group-types'
import type { WindowScope } from '../../../../shared/window-scope'

export type WindowScopeProject = {
  scope: WindowScope | null
  /** The bound group as this renderer's catalog knows it; null until its host's catalog has loaded. */
  group: ProjectGroup | null
  scopedWindowsEnabled: boolean
}

/**
 * The project this window is bound to, resolved against the renderer catalog. "Main cannot
 * resolve this id" is not "invalid": a remote host's group only exists here, so the scope stays
 * and the UI reads as loading until the catalog names it.
 */
export function useWindowScopeProject(): WindowScopeProject {
  // Why `??`: partial store mocks in sidebar tests omit the slice; an absent scope is a free window.
  const scope = useAppStore((s) => s.windowScope ?? null)
  const scopedWindowsEnabled = useAppStore((s) => s.scopedWindowsEnabled ?? false)
  const projectGroups = useAppStore((s) => s.projectGroups)
  return useMemo(
    () => ({
      scope,
      group: scope
        ? (projectGroups.find((group) => group.id === scope.projectGroupId) ?? null)
        : null,
      scopedWindowsEnabled
    }),
    [scope, projectGroups, scopedWindowsEnabled]
  )
}
