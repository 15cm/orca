import type { Store } from '../persistence'
import type { Project, ProjectHostSetup } from '../../shared/project-types'
import { normalizeExecutionHostId } from '../../shared/execution-host'
import { listEnvironments, resolveEnvironment } from '../../shared/runtime-environment-store'
import { getPreferredPairingOffer } from '../../shared/runtime-environments'
import { mainProcessState } from '../startup/main-process-state'
import { fingerprintPeerPublicKey } from '../runtime/peer-fingerprint'
import { subscribeProjectPrimaryAuthorityChanges } from '../runtime/project-primary-authority-notifier'
import { isRuntimeEnvironmentManuallyDisconnected } from './runtime-environment-connectivity-handlers'
import { callRuntimeEnvironment } from './runtime-environment-transport-routing'
import { listAuthenticatedProjectPeerWorktrees } from './project-primary-authority-peer-catalog'
import {
  startProjectPrimaryAuthorityRunner,
  type ProjectPrimaryAuthorityRunner,
  type RuntimeAuthorityClient
} from './project-primary-authority-subscription-runner'

const runners = new Map<string, ProjectPrimaryAuthorityRunner>()
let removePrimaryAuthorityListener: (() => void) | null = null
let refreshGeneration = 0

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function parseRemoteProject(value: unknown): Project | null {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    !value.id.trim() ||
    typeof value.displayName !== 'string' ||
    !value.displayName.trim() ||
    typeof value.badgeColor !== 'string' ||
    typeof value.createdAt !== 'number' ||
    !Number.isFinite(value.createdAt)
  ) {
    return null
  }
  return value as unknown as Project
}

function parseRemoteSetups(value: unknown, projectId: string): ProjectHostSetup[] {
  if (!isRecord(value) || !Array.isArray(value.setups)) {
    return []
  }
  return value.setups.filter((entry): entry is ProjectHostSetup => {
    if (
      !isRecord(entry) ||
      entry.projectId !== projectId ||
      typeof entry.id !== 'string' ||
      !entry.id.trim() ||
      typeof entry.repoId !== 'string' ||
      typeof entry.path !== 'string' ||
      typeof entry.displayName !== 'string' ||
      typeof entry.setupState !== 'string' ||
      typeof entry.setupMethod !== 'string'
    ) {
      return false
    }
    return typeof entry.hostId === 'string' && Boolean(normalizeExecutionHostId(entry.hostId))
  })
}

export async function startProjectPrimaryAuthoritySubscriptions(
  store: Store,
  userDataPath: string
): Promise<void> {
  const generation = ++refreshGeneration
  removePrimaryAuthorityListener?.()
  removePrimaryAuthorityListener = null
  const runtime = mainProcessState.runtime as RuntimeAuthorityClient | null
  const fingerprint = runtime?.getOwnPeerFingerprint?.()
  if (
    !runtime ||
    runtime.isDesktopPrimaryAuthority?.() !== true ||
    !fingerprint ||
    !runtime.bindPrimaryAuthorityFingerprint
  ) {
    for (const runner of runners.values()) {
      runner.stop()
    }
    runners.clear()
    return
  }
  const projectIds: string[] = []
  for (const project of store.getProjects()) {
    try {
      await runtime.bindPrimaryAuthorityFingerprint(project.id, fingerprint)
      if (generation !== refreshGeneration) {
        return
      }
      projectIds.push(project.id)
    } catch (error) {
      console.warn('[project-primary-authority] local authority binding failed:', error)
    }
  }
  const wanted = new Set(
    listEnvironments(userDataPath)
      .filter((environment) => !isRuntimeEnvironmentManuallyDisconnected(environment.id))
      .map((environment) => environment.id)
  )
  for (const [environmentId, runner] of runners) {
    if (!wanted.has(environmentId)) {
      runner.stop()
      runners.delete(environmentId)
    }
  }
  for (const environmentId of [...wanted].sort()) {
    let pairingKey: string
    let pairingRevision: number
    let pairedPeerFingerprint: string
    try {
      const environment = resolveEnvironment(userDataPath, environmentId)
      pairingRevision = environment.pairingRevision ?? environment.createdAt
      pairedPeerFingerprint = fingerprintPeerPublicKey(
        getPreferredPairingOffer(environment).publicKeyB64
      )
      pairingKey = `${environment.pairingRevision ?? environment.createdAt}\0${pairedPeerFingerprint}`
    } catch {
      const existingRunner = runners.get(environmentId)
      existingRunner?.stop()
      runners.delete(environmentId)
      continue
    }
    const rosterResponse = await callRuntimeEnvironment(
      userDataPath,
      environmentId,
      'project.list',
      null,
      15_000,
      pairingRevision
    )
    if (generation !== refreshGeneration) {
      return
    }
    let currentPairingKey: string | null = null
    try {
      const environment = resolveEnvironment(userDataPath, environmentId)
      currentPairingKey = `${environment.pairingRevision ?? environment.createdAt}\0${fingerprintPeerPublicKey(
        getPreferredPairingOffer(environment).publicKeyB64
      )}`
    } catch {
      currentPairingKey = null
    }
    if (currentPairingKey !== pairingKey || !rosterResponse.ok) {
      const existingRunner = runners.get(environmentId)
      existingRunner?.stop()
      runners.delete(environmentId)
      if (!rosterResponse.ok) {
        console.warn(
          `[project-primary-authority] project roster unavailable for ${environmentId}:`,
          rosterResponse.error.message
        )
      }
      continue
    }
    const rosterProjects =
      rosterResponse.result &&
      typeof rosterResponse.result === 'object' &&
      Array.isArray((rosterResponse.result as { projects?: unknown }).projects)
        ? (rosterResponse.result as { projects: unknown[] }).projects
        : []
    const remoteProjectIds = new Set(
      rosterProjects.flatMap((project) =>
        isRecord(project) && typeof project.id === 'string' && project.id.length > 0
          ? [project.id]
          : []
      )
    )
    const hasValidRemoteProject = rosterProjects.some((entry) => parseRemoteProject(entry) !== null)
    const setupResponse = hasValidRemoteProject
      ? await callRuntimeEnvironment(
          userDataPath,
          environmentId,
          'projectHostSetup.list',
          null,
          15_000,
          pairingRevision
        )
      : null
    const pairingIsCurrent = (): boolean => {
      if (
        generation !== refreshGeneration ||
        isRuntimeEnvironmentManuallyDisconnected(environmentId)
      ) {
        return false
      }
      try {
        const environment = resolveEnvironment(userDataPath, environmentId)
        return (
          `${environment.pairingRevision ?? environment.createdAt}\0${fingerprintPeerPublicKey(
            getPreferredPairingOffer(environment).publicKeyB64
          )}` === pairingKey
        )
      } catch {
        return false
      }
    }
    if (!pairingIsCurrent()) {
      return
    }
    if (setupResponse && !setupResponse.ok && setupResponse.error.code === 'method_not_found') {
      console.error(
        `[project-primary-authority] paired runtime is incompatible; update both Orca runtimes: ${environmentId}`
      )
    }
    for (const rawProject of rosterProjects) {
      if (!pairingIsCurrent()) {
        return
      }
      const remoteProject = parseRemoteProject(rawProject)
      if (!remoteProject) {
        continue
      }
      if (!setupResponse?.ok) {
        continue
      }
      try {
        const register = store.registerRemoteProjectAuthorityCompatibilityDurably
        if (!register) {
          throw new Error('remote_project_compatibility_unavailable')
        }
        const registered = await register.call(store, {
          remoteProject,
          hostId: `runtime:${environmentId}`,
          setups: parseRemoteSetups(setupResponse.result, remoteProject.id),
          authorityFingerprint: fingerprint,
          runtimeOwnerFingerprint: pairedPeerFingerprint,
          isCurrent: pairingIsCurrent
        })
        if (
          !Object.hasOwn(registered, 'primaryWorkspace') &&
          runtime.setPrimaryWorkspaceForPeer
        ) {
          const worktrees = await listAuthenticatedProjectPeerWorktrees(
            store,
            userDataPath,
            remoteProject.id,
            environmentId
          )
          if (!pairingIsCurrent()) {
            return
          }
          const original = worktrees
            .filter((entry) => entry.git?.isMainWorktree && !entry.git.isBare && !entry.git.prunable)
            .sort(
              (left, right) =>
                left.repoId.localeCompare(right.repoId) ||
                (left.ownerHostId ?? left.hostId ?? '').localeCompare(
                  right.ownerHostId ?? right.hostId ?? ''
                ) ||
                left.path.localeCompare(right.path) ||
                (left.instanceId ?? '').localeCompare(right.instanceId ?? '')
            )[0]
          if (original?.id && original.ownerHostId) {
            await runtime.setPrimaryWorkspaceForPeer(
              {
                projectId: remoteProject.id,
                worktree: `id:${original.id}`,
                hostId: original.ownerHostId
              },
              environmentId
            )
          }
        }
        if (!projectIds.includes(remoteProject.id)) {
          projectIds.push(remoteProject.id)
        }
      } catch (error) {
        console.warn(
          `[project-primary-authority] remote project compatibility registration failed for ${remoteProject.id}:`,
          error
        )
      }
    }
    const environmentProjectIds = projectIds.filter((id) => remoteProjectIds.has(id))
    if (environmentProjectIds.length === 0) {
      const existingRunner = runners.get(environmentId)
      existingRunner?.stop()
      runners.delete(environmentId)
      continue
    }
    const environmentProjectIdsKey = [...environmentProjectIds].sort().join('\0')
    const existingRunner = runners.get(environmentId)
    if (
      existingRunner?.projectIdsKey === environmentProjectIdsKey &&
      existingRunner.pairingKey === pairingKey
    ) {
      continue
    }
    existingRunner?.stop()
    runners.delete(environmentId)
    runners.set(
      environmentId,
      startProjectPrimaryAuthorityRunner({
        store,
        runtime,
        userDataPath,
        environmentId,
        projectIds: environmentProjectIds,
        projectIdsKey: environmentProjectIdsKey,
        pairingKey,
        allRunners: () => runners.values()
      })
    )
  }
  if (generation !== refreshGeneration) {
    return
  }
  removePrimaryAuthorityListener = subscribeProjectPrimaryAuthorityChanges((project) => {
    void Promise.allSettled(
      [...runners.values()]
        .filter((runner) => runner.projectIdsKey.split('\0').includes(project.id))
        .map((runner) => runner.broadcastSnapshot(project))
    )
  })
}
