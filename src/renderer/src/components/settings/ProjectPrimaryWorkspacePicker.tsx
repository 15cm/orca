import { useMemo, useRef, useState } from 'react'
import { Check, ChevronsUpDown, Circle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '../ui/command'
import { SearchableSetting } from './SearchableSetting'
import { useAppStore } from '../../store'
import {
  hasSavedPrimaryWorkspace,
  resolveProjectPrimaryWorkspace
} from '../../../../shared/project-primary-workspace'
import { translate } from '@/i18n/i18n'
import { getProjectPrimaryWorkspaceEligibility } from '../project-primary-workspace-eligibility'
import { getRepoHostIdentity } from '../../store/slices/repo-host-identity'
import { resolvePaletteRepoForWorktree } from '../../lib/palette-repo-resolution'
import { getPaletteWorktreeExecutionHostId } from '../../lib/palette-repo-resolution'
import { selectExecutionHostDisplayLabel } from '../../lib/execution-host-display-label'
import { getExplicitRuntimeEnvironmentIdForWorktree } from '../../lib/worktree-runtime-owner'
import type { AppState } from '../../store/types'

export function ProjectPrimaryWorkspacePicker({
  projectId
}: {
  projectId: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const projects = useAppStore((state) => state.projects)
  const repos = useAppStore((state) => state.repos)
  const sshConnectionStates = useAppStore((state) => state.sshConnectionStates)
  const runtimeStatusByEnvironmentId = useAppStore((state) => state.runtimeStatusByEnvironmentId)
  const sshStateByEnvironment = useAppStore((state) => state.sshStateByEnvironment)
  const sshTargetLabels = useAppStore((state) => state.sshTargetLabels)
  const removedSshTargetLabels = useAppStore((state) => state.removedSshTargetLabels)
  const sshTargetsHydrated = useAppStore((state) => state.sshTargetsHydrated)
  const worktreesByRepo = useAppStore((state) => state.worktreesByRepo)
  const settings = useAppStore((state) => state.settings)
  const runtimeEnvironments = useAppStore((state) => state.runtimeEnvironments)
  const displayState = useMemo(
    () =>
      ({
        settings,
        runtimeEnvironments,
        sshConnectionStates,
        runtimeStatusByEnvironmentId,
        sshStateByEnvironment,
        sshTargetLabels,
        removedSshTargetLabels,
        sshTargetsHydrated,
        worktreesByRepo,
        repos
      }) as unknown as AppState,
    [
      settings,
      runtimeEnvironments,
      sshConnectionStates,
      runtimeStatusByEnvironmentId,
      sshStateByEnvironment,
      sshTargetLabels,
      removedSshTargetLabels,
      sshTargetsHydrated,
      worktreesByRepo,
      repos
    ]
  )
  const worktrees = useMemo(
    () =>
      Object.values(worktreesByRepo)
        .flat()
        .filter((worktree) => worktree.projectId === projectId),
    [worktreesByRepo, projectId]
  )
  const project = projects.find((candidate) => candidate.id === projectId)
  const current = project ? resolveProjectPrimaryWorkspace(project, worktrees) : undefined
  const saved = project?.primaryWorkspace
  const hasSaved = project ? hasSavedPrimaryWorkspace(project) : false
  const repoMaps = useMemo(
    () => ({
      byId: new Map(repos.map((repo) => [repo.id, repo])),
      byHostIdentity: new Map(repos.map((repo) => [getRepoHostIdentity(repo), repo]))
    }),
    [repos]
  )
  const liveness = useMemo(
    () => ({
      sshConnectionStates,
      runtimeStatusByEnvironmentId,
      sshStateByEnvironment,
      sshTargetLabels,
      removedSshTargetLabels,
      sshTargetsHydrated
    }),
    [
      sshConnectionStates,
      runtimeStatusByEnvironmentId,
      sshStateByEnvironment,
      sshTargetLabels,
      removedSshTargetLabels,
      sshTargetsHydrated
    ]
  )
  const options = useMemo(
    () =>
      worktrees.map((worktree) => {
        const repo = resolvePaletteRepoForWorktree(worktree, repoMaps.byId, repoMaps.byHostIdentity)
        const reason = getProjectPrimaryWorkspaceEligibility(worktree, repo, liveness)
        const hostId = getPaletteWorktreeExecutionHostId(worktree)
        const hostLabel = hostId
          ? selectExecutionHostDisplayLabel(displayState, hostId, {
              sshEnvironmentId: getExplicitRuntimeEnvironmentIdForWorktree(displayState, worktree.id)
            })
          : translate(
              'auto.components.settings.ProjectPrimaryWorkspacePicker.local',
              'local'
            )
        return { worktree, reason, hostLabel }
      }),
    [worktrees, repoMaps, liveness, displayState]
  )
  const currentReason = current
    ? options.find((option) => option.worktree === current)?.reason
    : undefined
  const currentWorktree = currentReason ? undefined : current
  const savedUnavailable = hasSaved && (!current || currentReason)
  const savedUnavailableDetails = savedUnavailable
    ? [saved?.path, saved?.hostId, saved?.worktreeId]
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
        .join(' · ')
    : ''
  const savedUnavailableLabel = translate(
    'auto.components.settings.ProjectPrimaryWorkspacePicker.unavailable',
    'Saved workspace unavailable'
  )
  const savedUnavailableDescription = savedUnavailableDetails
    ? `${savedUnavailableLabel}: ${savedUnavailableDetails}`
    : savedUnavailableLabel
  const setPrimary = useAppStore((state) => state.setProjectPrimaryWorkspace)
  const [pending, setPending] = useState(false)
  const pendingRef = useRef(false)

  return (
    <SearchableSetting
      title={translate(
        'auto.components.settings.ProjectPrimaryWorkspacePicker.title',
        'Primary workspace'
      )}
      description={translate(
        'auto.components.settings.ProjectPrimaryWorkspacePicker.description',
        'Workspace used for project level operations.'
      )}
      keywords={['primary', 'workspace', 'branch', 'path', 'host']}
      className="space-y-2"
    >
      <div className="text-sm font-semibold">
        {translate(
          'auto.components.settings.ProjectPrimaryWorkspacePicker.label',
          'Primary workspace'
        )}
      </div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between"
            disabled={pending}
          >
            {currentWorktree?.displayName ??
              (savedUnavailable
                ? savedUnavailableDescription
                : translate(
                    'auto.components.settings.ProjectPrimaryWorkspacePicker.choose',
                    'Choose workspace'
                  ))}
            <ChevronsUpDown className="ml-2 size-4 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[min(32rem,calc(100vw-2rem))] p-0" align="start">
          <Command>
            <CommandInput
              placeholder={translate(
                'auto.components.settings.ProjectPrimaryWorkspacePicker.search',
                'Search workspace…'
              )}
            />
            <CommandList>
              <CommandEmpty>
                {translate(
                  'auto.components.settings.ProjectPrimaryWorkspacePicker.empty',
                  'No workspaces found.'
                )}
              </CommandEmpty>
              {options.map(({ worktree, reason, hostLabel }) => (
                <CommandItem
                  key={`${getPaletteWorktreeExecutionHostId(worktree) ?? 'local'}:${worktree.ownerHostId ?? ''}:${worktree.peerFingerprint ?? ''}:${worktree.instanceId ?? worktree.id}`}
                  disabled={pending || Boolean(reason)}
                  value={`${worktree.displayName} ${worktree.branch ?? ''} ${worktree.path} ${hostLabel} ${worktree.hostId ?? ''}`}
                  onSelect={async () => {
                    if (pendingRef.current || reason) {
                      return
                    }
                    pendingRef.current = true
                    setPending(true)
                    let result
                    try {
                      result = await setPrimary(projectId, worktree.id, worktree.hostId)
                    } catch (error) {
                      result = { error }
                    } finally {
                      pendingRef.current = false
                      setPending(false)
                    }
                    if ('error' in result) {
                      toast.error(
                        translate(
                          'auto.components.settings.ProjectPrimaryWorkspacePicker.error',
                          'Unable to set primary workspace.'
                        )
                      )
                      return
                    }
                    setOpen(false)
                  }}
                >
                  {current === worktree ? (
                    <Check className="mr-2 size-4" />
                  ) : (
                    <Circle className="mr-2 size-2 opacity-40" />
                  )}
                  <span className="min-w-0">
                    <span className="block truncate">{worktree.displayName}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {worktree.branch ??
                        translate(
                          'auto.components.settings.ProjectPrimaryWorkspacePicker.workspace',
                          'workspace'
                        )}{' '}
                      · {worktree.path} ·{' '}
                      {hostLabel}
                    </span>
                    {reason ? (
                      <span className="block truncate text-xs text-muted-foreground">{reason}</span>
                    ) : null}
                  </span>
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {savedUnavailable ? (
        <p className="text-xs text-muted-foreground">{savedUnavailableDescription}</p>
      ) : null}
    </SearchableSetting>
  )
}
