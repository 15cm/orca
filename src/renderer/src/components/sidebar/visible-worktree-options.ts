import type { Repo } from '../../../../shared/repo-types'
import type { Worktree } from '../../../../shared/worktree/types'
import { getAllWorktreesFromState } from '@/store/selectors'
import {
  hasSavedPrimaryWorkspace,
  resolveProjectPrimaryWorkspace
} from '../../../../shared/project-primary-workspace'
import {
  getSettingsFocusedExecutionHostId,
  type ExecutionHostId,
  type ExecutionHostScope
} from '../../../../shared/execution-host'
import type { TerminalTab } from '../../../../shared/terminal-tab-types'
import type { WorktreeLineage } from '../../../../shared/worktree/lineage-types'
import type { AppState } from '@/store/types'
import { getWorktreeIdsWithLiveAgent } from '@/lib/worktree-activity-state'
import {
  EMPTY_PAIRED_DEVICE_IDS_BY_ENVIRONMENT,
  getPairedDeviceIdsByEnvironment
} from './workspace-creator-visibility'
import { selectEffectiveFilterRepoIds } from './project-filter-resolution'

export type VisibleWorktreeOptions = {
  filterRepoIds: readonly string[]
  showSleepingWorkspaces: boolean
  tabsByWorktree: Record<string, Pick<TerminalTab, 'id'>[]> | null
  ptyIdsByTabId: Record<string, string[]> | null
  browserTabsByWorktree?: Record<string, { id: string }[]> | null
  worktreeIdsWithLiveAgent: ReadonlySet<string>
  hideDefaultBranchWorkspace: boolean
  hideAutomationGeneratedWorkspaces: boolean
  hideCliCreatedWorkspaces: boolean
  hideDetachedHeadWorkspaces: boolean
  hideWorkspacesFromOtherDevices: boolean
  pairedDeviceIdsByEnvironment: ReadonlyMap<string, string>
  alwaysShowDefaultBranchWorkspace?: boolean
  repoMap: Map<string, Repo>
  workspaceHostScope: ExecutionHostScope
  visibleWorkspaceHostIds?: readonly ExecutionHostId[] | null
  defaultHostId: ExecutionHostId
  worktreeLineageById: Record<string, WorktreeLineage>
  injectLineageAncestors?: boolean
  forcedVisibleWorktreeIds?: readonly string[]
  primaryWorktreeIdentities?: ReadonlySet<string>
  savedPrimaryRepoIds?: ReadonlySet<string>
}

export function getPrimaryWorktreeIdentity(worktree: Worktree): string {
  return JSON.stringify([
    worktree.peerFingerprint ?? '',
    worktree.ownerHostId ?? worktree.hostId ?? '',
    worktree.hostId ?? '',
    worktree.instanceId ?? '',
    worktree.id
  ])
}

export function buildVisibleWorktreeOptionsFromState(
  state: AppState,
  repoMap: Map<string, Repo>
): VisibleWorktreeOptions {
  const catalog = getAllWorktreesFromState({ worktreesByRepo: state.worktreesByRepo })
  const primaryWorktreeIdentities = new Set<string>()
  const savedPrimaryRepoIds = new Set<string>()
  for (const project of state.projects) {
    if (hasSavedPrimaryWorkspace(project)) {
      for (const repoId of project.sourceRepoIds) {
        savedPrimaryRepoIds.add(repoId)
      }
    }
    const primary = resolveProjectPrimaryWorkspace(project, catalog)
    if (primary) {
      primaryWorktreeIdentities.add(getPrimaryWorktreeIdentity(primary))
    }
  }
  return {
    filterRepoIds: selectEffectiveFilterRepoIds({
      filterRepoIds: state.filterRepoIds,
      filterGroupIds: state.filterGroupIds,
      repos: state.repos,
      projectGroups: state.projectGroups
    }),
    showSleepingWorkspaces: state.showSleepingWorkspaces,
    tabsByWorktree: state.tabsByWorktree,
    ptyIdsByTabId: state.ptyIdsByTabId,
    browserTabsByWorktree: state.browserTabsByWorktree,
    worktreeIdsWithLiveAgent: getWorktreeIdsWithLiveAgent(
      state.agentStatusByPaneKey,
      state.tabsByWorktree,
      Date.now()
    ),
    hideDefaultBranchWorkspace: state.hideDefaultBranchWorkspace,
    hideAutomationGeneratedWorkspaces: state.hideAutomationGeneratedWorkspaces,
    hideCliCreatedWorkspaces: state.hideCliCreatedWorkspaces,
    hideDetachedHeadWorkspaces: state.hideDetachedHeadWorkspaces,
    hideWorkspacesFromOtherDevices: state.hideWorkspacesFromOtherDevices,
    primaryWorktreeIdentities,
    savedPrimaryRepoIds,
    pairedDeviceIdsByEnvironment: state.hideWorkspacesFromOtherDevices
      ? getPairedDeviceIdsByEnvironment(
          state.runtimeEnvironments,
          state.runtimeStatusByEnvironmentId
        )
      : EMPTY_PAIRED_DEVICE_IDS_BY_ENVIRONMENT,
    alwaysShowDefaultBranchWorkspace: state.alwaysShowDefaultBranchWorkspace,
    repoMap,
    workspaceHostScope: state.workspaceHostScope,
    visibleWorkspaceHostIds: state.visibleWorkspaceHostIds,
    defaultHostId: getSettingsFocusedExecutionHostId(state.settings),
    worktreeLineageById: state.worktreeLineageById
  }
}
