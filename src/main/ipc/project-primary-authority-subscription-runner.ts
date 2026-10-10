import type { Store } from '../persistence'
import type { Project } from '../../shared/project-types'
import type {
  ProjectPrimaryAuthorityEvent,
  ProjectPrimaryAuthorityRequestResult
} from '../../shared/project-primary-authority-protocol'
import { ProjectPrimaryAuthorityWorkspaceParams } from '../../shared/project-primary-authority-protocol'
import { resolveEnvironment } from '../../shared/runtime-environment-store'
import { getPreferredPairingOffer } from '../../shared/runtime-environments'
import { fingerprintPeerPublicKey } from '../runtime/peer-fingerprint'
import { isRuntimeEnvironmentManuallyDisconnected } from './runtime-environment-connectivity-handlers'
import { subscribeRuntimeEnvironment } from './runtime-environment-transport-routing'

type Subscription = {
  close: () => void
  sendRequest?: (
    method: string,
    params: unknown,
    timeoutMs: number
  ) => Promise<{ ok: boolean; result?: unknown; error?: { message: string } }>
}
export type RuntimeAuthorityClient = {
  isDesktopPrimaryAuthority?: () => boolean
  getOwnPeerFingerprint?: () => string | null
  bindPrimaryAuthorityFingerprint?: (projectId: string, fingerprint: string) => Promise<unknown>
  setPrimaryWorkspace?: (args: {
    projectId: string
    worktree: string
    hostId?: string
  }) => Promise<unknown>
  setPrimaryWorkspaceForPeer?: (
    args: { projectId: string; worktree: string; hostId?: string },
    environmentId: string
  ) => Promise<unknown>
  beginPrimaryRemoval?: (projectId: string, target: ProjectTarget) => Promise<string>
  beginPrimaryRemovalForPeer?: (
    projectId: string,
    target: ProjectTarget,
    environmentId: string
  ) => Promise<string>
  recordPrimaryRemovalCompletion?: (token: string, target: ProjectTarget) => Promise<void>
  finishPrimaryRemoval?: (token: string, target: ProjectTarget) => Promise<boolean>
  guardPrimarySetupRemoval?: (setupId: string, expectedHostId: string) => Promise<void>
  guardPrimaryProjectRemoval?: (repoId: string, expectedHostId: string) => Promise<void>
  beginProjectRemovalPermit?: (
    projectId: string,
    resourceKey: string,
    environmentId: string,
    requesterFingerprint: string
  ) => Promise<string>
  finishProjectRemovalPermit?: (
    token: string,
    projectId: string,
    resourceKey: string,
    requesterFingerprint: string,
    isCurrent: () => boolean
  ) => Promise<boolean>
}
type ProjectTarget = { peerFingerprint: string; hostId: string; instanceId: string; path?: string }

function encodeSavedWorkspace(project: Project): Project['primaryWorkspace'] | null | undefined {
  const rawWorkspace = (project as { primaryWorkspace?: unknown }).primaryWorkspace
  if (rawWorkspace === undefined) {
    return undefined
  }
  const parsed = ProjectPrimaryAuthorityWorkspaceParams.safeParse(rawWorkspace)
  return parsed.success ? parsed.data : null
}

export type ProjectSnapshot = Pick<
  Project,
  'id' | 'primaryAuthorityFingerprint' | 'primaryWorkspace' | 'primaryWorkspaceRevision'
>
export type ProjectPrimaryAuthorityRunner = {
  stop: () => void
  projectIdsKey: string
  pairingKey: string
  broadcastSnapshot: (project: ProjectSnapshot) => Promise<void>
}

export function startProjectPrimaryAuthorityRunner(input: {
  store: Store
  runtime: RuntimeAuthorityClient
  userDataPath: string
  environmentId: string
  projectIds: string[]
  projectIdsKey: string
  pairingKey: string
  allRunners: () => Iterable<ProjectPrimaryAuthorityRunner>
}): ProjectPrimaryAuthorityRunner {
  const { store, runtime, userDataPath, environmentId, projectIds, projectIdsKey, pairingKey } =
    input
  const requesterFingerprint = pairingKey.slice(pairingKey.indexOf('\0') + 1)
  const controller = new AbortController()
  type Attempt = {
    owner: object
    subscription: Subscription | null
    fences: Map<string, { epoch: string; generation: number }>
    isCurrent: () => boolean
  }
  let activeAttempt: Attempt | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  const close = (): void => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
    }
    reconnectTimer = null
    activeAttempt?.subscription?.close()
    activeAttempt = null
  }
  const scheduleReconnect = (): void => {
    if (controller.signal.aborted || reconnectTimer) {
      return
    }
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      void connect()
    }, 2_000)
  }
  const pairingIsCurrent = (revision: number, fingerprint: string): boolean => {
    if (controller.signal.aborted || isRuntimeEnvironmentManuallyDisconnected(environmentId)) {
      return false
    }
    try {
      const environment = resolveEnvironment(userDataPath, environmentId)
      return (
        (environment.pairingRevision ?? environment.createdAt) === revision &&
        fingerprintPeerPublicKey(getPreferredPairingOffer(environment).publicKeyB64) === fingerprint
      )
    } catch {
      return false
    }
  }
  const respond = async (
    subscription: Subscription,
    event: ProjectPrimaryAuthorityEvent,
    isCurrent: () => boolean
  ): Promise<void> => {
    if (event.type !== 'request') {
      return
    }
    const response: ProjectPrimaryAuthorityRequestResult = {
      requestId: event.requestId,
      epoch: event.epoch,
      generation: event.generation,
      projectId: event.projectId,
      ok: false,
      error: 'primary_authority_request_failed'
    }
    try {
      if (activeAttempt?.subscription !== subscription || !isCurrent()) {
        throw new Error('stale_primary_authority_connection')
      }
      if (event.operation === 'remove.begin' || event.operation === 'remove.finish') {
        const targetFingerprint = event.target?.peerFingerprint
        const currentEnvironment = resolveEnvironment(userDataPath, environmentId)
        const pairedFingerprint = fingerprintPeerPublicKey(
          getPreferredPairingOffer(currentEnvironment).publicKeyB64
        )
        if (!targetFingerprint || targetFingerprint !== pairedFingerprint) {
          throw new Error('primary_workspace_owner_mismatch')
        }
      }
      let removalToken: string | undefined
      if (event.operation === 'set') {
        if ((!runtime.setPrimaryWorkspace && !runtime.setPrimaryWorkspaceForPeer) || !event.selector) {
          throw new Error('invalid_primary_authority_request')
        }
        const peerRuntimeHostId = `runtime:${environmentId}`
        if (event.hostId?.startsWith('runtime:') && event.hostId !== peerRuntimeHostId) {
          throw new Error('primary_workspace_owner_outside_authenticated_peer')
        }
        const selector = {
          projectId: event.projectId,
          worktree: event.selector,
          ...(event.hostId !== undefined ? { hostId: event.hostId } : {})
        }
        if (runtime.setPrimaryWorkspaceForPeer) {
          await runtime.setPrimaryWorkspaceForPeer(selector, environmentId)
        } else if (runtime.setPrimaryWorkspace) {
          await runtime.setPrimaryWorkspace({
            ...selector,
            hostId:
              event.hostId === undefined || event.hostId === 'local'
                ? peerRuntimeHostId
                : event.hostId
          })
        }
      } else if (event.operation === 'remove.begin') {
        if ((!runtime.beginPrimaryRemoval && !runtime.beginPrimaryRemovalForPeer) || !event.target) {
          throw new Error('invalid_primary_authority_request')
        }
        if (runtime.beginPrimaryRemovalForPeer) {
          removalToken = await runtime.beginPrimaryRemovalForPeer(
            event.projectId,
            event.target,
            environmentId
          )
        } else if (runtime.beginPrimaryRemoval) {
          removalToken = await runtime.beginPrimaryRemoval(event.projectId, event.target)
        } else {
          throw new Error('invalid_primary_authority_request')
        }
      } else if (event.operation === 'remove.finish') {
        if (
          !event.token ||
          !event.target ||
          !runtime.recordPrimaryRemovalCompletion ||
          !runtime.finishPrimaryRemoval
        ) {
          throw new Error('invalid_primary_authority_request')
        }
        await runtime.recordPrimaryRemovalCompletion(event.token, event.target)
        if (!(await runtime.finishPrimaryRemoval(event.token, event.target))) {
          throw new Error('primary_removal_completion_unconfirmed')
        }
      } else if (event.operation === 'remove.setup') {
        if (!event.setupId || !event.authorizationPhase) {
          throw new Error('invalid_primary_authority_request')
        }
        const resourceKey = `setup:${event.setupId}`
        if (event.authorizationPhase === 'begin') {
          if (!runtime.beginProjectRemovalPermit) {
            throw new Error('invalid_primary_authority_request')
          }
          removalToken = await runtime.beginProjectRemovalPermit(
            event.projectId,
            resourceKey,
            environmentId,
            requesterFingerprint
          )
        } else if (
          !event.token ||
          !runtime.finishProjectRemovalPermit ||
          !(await runtime.finishProjectRemovalPermit(
            event.token,
            event.projectId,
            resourceKey,
            requesterFingerprint,
            isCurrent
          ))
        ) {
          throw new Error('primary_project_removal_completion_unconfirmed')
        }
      } else if (event.operation === 'remove.project') {
        if (!event.repoId || !event.authorizationPhase) {
          throw new Error('invalid_primary_authority_request')
        }
        const resourceKey = `repo:${event.repoId}`
        if (event.authorizationPhase === 'begin') {
          if (!runtime.beginProjectRemovalPermit) {
            throw new Error('invalid_primary_authority_request')
          }
          removalToken = await runtime.beginProjectRemovalPermit(
            event.projectId,
            resourceKey,
            environmentId,
            requesterFingerprint
          )
        } else if (
          !event.token ||
          !runtime.finishProjectRemovalPermit ||
          !(await runtime.finishProjectRemovalPermit(
            event.token,
            event.projectId,
            resourceKey,
            requesterFingerprint,
            isCurrent
          ))
        ) {
          throw new Error('primary_project_removal_completion_unconfirmed')
        }
      }
      if (activeAttempt?.subscription !== subscription || !isCurrent()) {
        throw new Error('stale_primary_authority_connection')
      }
      const project = store.getProjects().find((entry) => entry.id === event.projectId)
      if (!project?.primaryAuthorityFingerprint) {
        throw new Error('primary_authority_unavailable')
      }
      const primaryWorkspace = encodeSavedWorkspace(project)
      if (event.operation === 'set' || event.operation === 'remove.finish') {
        await Promise.allSettled(
          [...input.allRunners()]
            .filter((runner) => runner.projectIdsKey.split('\0').includes(project.id))
            .map((runner) => runner.broadcastSnapshot(project))
        )
      }
      Object.assign(response, {
        ok: true,
        primaryAuthorityFingerprint: project.primaryAuthorityFingerprint,
        revision: project.primaryWorkspaceRevision ?? 0,
        ...(primaryWorkspace !== undefined ? { primaryWorkspace } : {}),
        ...(removalToken ? { removalToken } : {}),
        error: undefined
      })
    } catch (error) {
      response.error =
        error instanceof Error ? error.message.slice(0, 512) : 'primary_authority_request_failed'
    }
    const sendRequest = subscription.sendRequest
    if (!sendRequest) {
      throw new Error('primary_authority_result_transport_unavailable')
    }
    if (activeAttempt?.subscription !== subscription || !isCurrent()) {
      throw new Error('stale_primary_authority_connection')
    }
    const result = await sendRequest('project.primary.authority.requestResult', response, 15_000)
    if (activeAttempt?.subscription !== subscription || !isCurrent()) {
      throw new Error('stale_primary_authority_connection')
    }
    if (!result.ok) {
      throw new Error(result.error?.message ?? 'primary_authority_result_rejected')
    }
  }

  const connect = async (): Promise<void> => {
    let pairingRevision: number
    let peerFingerprint: string
    try {
      const environment = resolveEnvironment(userDataPath, environmentId)
      pairingRevision = environment.pairingRevision ?? environment.createdAt
      peerFingerprint = fingerprintPeerPublicKey(getPreferredPairingOffer(environment).publicKeyB64)
    } catch {
      scheduleReconnect()
      return
    }
    const owner = {}
    const attempt: Attempt = {
      owner,
      subscription: null,
      fences: new Map(),
      isCurrent: () =>
        activeAttempt === attempt && pairingIsCurrent(pairingRevision, peerFingerprint)
    }
    const isCurrent = attempt.isCurrent
    activeAttempt = attempt
    if (!pairingIsCurrent(pairingRevision, peerFingerprint)) {
      scheduleReconnect()
      return
    }
    try {
      let established: Subscription | null = null
      const earlyEvents: ProjectPrimaryAuthorityEvent[] = []
      const subscription = (await subscribeRuntimeEnvironment(
        userDataPath,
        environmentId,
        'project.primary.authority.attach',
        { projectIds },
        15_000,
        {
          onEvent: (event) => {
            if (!isCurrent()) {
              return
            }
            if (event.type === 'response' && event.response.ok) {
              const value = event.response.result as ProjectPrimaryAuthorityEvent
              if (value.type === 'ready') {
                for (const projectId of value.projectIds) {
                  attempt.fences.set(projectId, {
                    epoch: value.epoch,
                    generation: value.generation
                  })
                }
                return
              }
              if (value.type === 'disconnected') {
                for (const [projectId, fence] of attempt.fences) {
                  if (fence.epoch === value.epoch && fence.generation === value.generation) {
                    attempt.fences.delete(projectId)
                  }
                }
                return
              }
              if (!established) {
                earlyEvents.push(value)
              } else {
                void respond(established, value, isCurrent).catch((error) => {
                  console.warn('[project-primary-authority] result delivery failed:', error)
                })
              }
            } else if (event.type === 'error') {
              if (event.code === 'method_not_found') {
                console.error(
                  '[project-primary-authority] paired runtime is incompatible; update both Orca runtimes:',
                  event.message
                )
              } else {
                console.warn('[project-primary-authority] peer attachment failed:', event.message)
              }
            } else if (event.type === 'close') {
              if (activeAttempt !== attempt || attempt.owner !== owner) {
                return
              }
              activeAttempt = null
              attempt.fences.clear()
              scheduleReconnect()
            }
          },
          onClose: () => {
            if (activeAttempt !== attempt || attempt.owner !== owner) {
              return
            }
            activeAttempt = null
            attempt.fences.clear()
            scheduleReconnect()
          }
        },
        isCurrent
      )) as Subscription
      established = subscription
      if (!isCurrent()) {
        subscription.close()
        if (activeAttempt === attempt) {
          activeAttempt = null
        }
        scheduleReconnect()
        return
      }
      attempt.subscription = subscription
      for (const event of earlyEvents) {
        void respond(subscription, event, isCurrent).catch((error) => {
          console.warn('[project-primary-authority] result delivery failed:', error)
        })
      }
    } catch (error) {
      console.warn('[project-primary-authority] peer attachment unavailable:', error)
      scheduleReconnect()
    }
  }

  const runner: ProjectPrimaryAuthorityRunner = {
    projectIdsKey,
    pairingKey,
    stop: () => {
      controller.abort()
      close()
    },
    broadcastSnapshot: async (project) => {
      const attempt = activeAttempt
      const subscription = attempt?.subscription
      const fence = attempt?.fences.get(project.id)
      if (!attempt || !subscription?.sendRequest || !fence || !attempt.isCurrent()) {
        return
      }
      const primaryWorkspace = encodeSavedWorkspace(project as Project)
      const result = await subscription.sendRequest(
        'project.primary.authority.requestResult',
        {
          kind: 'snapshot',
          epoch: fence.epoch,
          generation: fence.generation,
          projectId: project.id,
          primaryAuthorityFingerprint: project.primaryAuthorityFingerprint,
          revision: project.primaryWorkspaceRevision ?? 0,
          ...(primaryWorkspace !== undefined ? { primaryWorkspace } : {})
        },
        15_000
      )
      if (!result.ok || (result.result as { accepted?: boolean })?.accepted !== true) {
        throw new Error('primary_authority_snapshot_broadcast_failed')
      }
    }
  }
  void connect()
  return runner
}
