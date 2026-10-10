import type { Repo } from '../../../shared/repo-types'
import type { Worktree } from '../../../shared/worktree/types'
import { isFolderRepo } from '../../../shared/repo-kind'
import { translate } from '@/i18n/i18n'
import type { AppState } from '../store/types'
import { getRepoSshConnectionId } from '../../../shared/execution-host'
import { selectRuntimeAwareSshStatus } from '../store/slices/runtime-environment-ssh-selectors'

type WorkspaceLivenessState = Pick<
  AppState,
  | 'sshConnectionStates'
  | 'sshTargetLabels'
  | 'removedSshTargetLabels'
  | 'sshTargetsHydrated'
  | 'sshStateByEnvironment'
  | 'runtimeStatusByEnvironmentId'
>

export function getProjectPrimaryWorkspaceAvailabilityReason(
  worktree: Worktree,
  repo: Repo | null | undefined,
  state: WorkspaceLivenessState
): string | undefined {
  const environmentId =
    worktree.runtimeOwnerEnvironmentId ??
    (worktree.hostId?.startsWith('runtime:') ? worktree.hostId.slice('runtime:'.length) : null)
  if (environmentId && !state.runtimeStatusByEnvironmentId.get(environmentId)?.status) {
    return translate(
      'auto.components.primaryWorkspace.disconnected',
      'Workspace host is disconnected.'
    )
  }
  const connectionId = repo ? getRepoSshConnectionId(repo) : null
  if (
    connectionId &&
    selectRuntimeAwareSshStatus(state, environmentId, connectionId) !== 'connected'
  ) {
    return translate(
      'auto.components.primaryWorkspace.disconnected',
      'Workspace host is disconnected.'
    )
  }
  return undefined
}

export function getProjectPrimaryWorkspaceEligibility(
  worktree: Worktree,
  repo?: Repo | null,
  liveness?: WorkspaceLivenessState
): string | undefined {
  if (!repo || (isFolderRepo(repo) && !(worktree.path === repo.path && worktree.isMainWorktree))) {
    return translate(
      'auto.components.primaryWorkspace.invalidFolder',
      'Only the registered project folder can be primary.'
    )
  }
  if (
    !worktree.projectId ||
    !worktree.peerFingerprint ||
    !worktree.instanceId ||
    !worktree.hostId
  ) {
    return translate(
      'auto.components.primaryWorkspace.invalidIdentity',
      'Workspace owner identity is unavailable.'
    )
  }
  if (worktree.isArchived || worktree.isBare || worktree.prunable) {
    return translate(
      'auto.components.primaryWorkspace.invalidState',
      'Archived, bare, or prunable workspaces cannot be primary.'
    )
  }
  if (liveness) {
    const unavailable = getProjectPrimaryWorkspaceAvailabilityReason(worktree, repo, liveness)
    if (unavailable) {
      return unavailable
    }
  }
  return undefined
}
