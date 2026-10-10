import React from 'react'
import { Check } from 'lucide-react'
import { toast } from 'sonner'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '../../store'
import { resolveProjectPrimaryWorkspace } from '../../../../shared/project-primary-workspace'
import type { Repo } from '../../../../shared/repo-types'
import type { Worktree } from '../../../../shared/worktree/types'
import { getProjectPrimaryWorkspaceEligibility } from '../project-primary-workspace-eligibility'

export function WorktreePrimaryContextMenuItem({
  worktree,
  repo,
  disabled
}: {
  worktree: Worktree
  repo?: Repo | null
  disabled: boolean
}): React.JSX.Element {
  const [pending, setPending] = React.useState(false)
  const pendingRef = React.useRef(false)
  const setPrimary = useAppStore((state) => state.setProjectPrimaryWorkspace)
  const project = useAppStore((state) =>
    state.projects.find((candidate) => candidate.id === worktree.projectId)
  )
  const worktreesByRepo = useAppStore((state) => state.worktreesByRepo)
  const sshConnectionStates = useAppStore((state) => state.sshConnectionStates)
  const runtimeStatusByEnvironmentId = useAppStore((state) => state.runtimeStatusByEnvironmentId)
  const sshStateByEnvironment = useAppStore((state) => state.sshStateByEnvironment)
  const sshTargetLabels = useAppStore((state) => state.sshTargetLabels)
  const removedSshTargetLabels = useAppStore((state) => state.removedSshTargetLabels)
  const sshTargetsHydrated = useAppStore((state) => state.sshTargetsHydrated)
  const catalog = React.useMemo(() => Object.values(worktreesByRepo).flat(), [worktreesByRepo])
  const current = project ? resolveProjectPrimaryWorkspace(project, catalog) : undefined
  const invalidReason = getProjectPrimaryWorkspaceEligibility(worktree, repo, {
    sshConnectionStates,
    runtimeStatusByEnvironmentId,
    sshStateByEnvironment,
    sshTargetLabels,
    removedSshTargetLabels,
    sshTargetsHydrated
  })
  const identity = current === worktree

  const handleSelect = (): void => {
    if (!worktree.projectId || invalidReason || pendingRef.current) {
      return
    }
    pendingRef.current = true
    setPending(true)
    void setPrimary(worktree.projectId, worktree.id, worktree.hostId)
      .then((result) => {
        if ('error' in result) {
          toast.error(
            translate(
              'auto.components.sidebar.WorktreeContextMenu.primaryError',
              'Unable to set primary workspace.'
            )
          )
        }
      })
      .catch(() =>
        toast.error(
          translate(
            'auto.components.sidebar.WorktreeContextMenu.primaryError',
            'Unable to set primary workspace.'
          )
        )
      )
      .finally(() => {
        pendingRef.current = false
        setPending(false)
      })
  }

  return (
    <>
      <DropdownMenuItem
        disabled={disabled || pending || Boolean(invalidReason) || identity}
        onSelect={handleSelect}
      >
        <Check className="size-3.5" />
        {translate('auto.components.sidebar.WorktreeContextMenu.setPrimary', 'Set as primary')}
      </DropdownMenuItem>
      {invalidReason ? (
        <p className="px-2 pb-1 text-xs text-muted-foreground">{invalidReason}</p>
      ) : null}
    </>
  )
}
