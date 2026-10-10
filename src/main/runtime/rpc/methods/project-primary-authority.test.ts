import { describe, expect, it, vi } from 'vitest'
import { PROJECT_PRIMARY_AUTHORITY_RUNTIME_CAPABILITY } from '../../../../shared/protocol-version'
import type { ProjectPrimaryAuthorityEvent } from '../../../../shared/project-primary-authority-protocol'
import type { Project } from '../../../../shared/project-types'
import { RpcDispatcher } from '../dispatcher'
import type { RpcRequest } from '../core'
import { getProjectPrimaryAuthorityRegistry } from '../../project-primary-authority-registry'
import { ALL_RPC_METHODS } from './index'

const peerFingerprint = 'desktop-fingerprint'
const projectId = 'project-a'

function createRuntime() {
  const project: Project = {
    id: projectId,
    displayName: 'Project A',
    badgeColor: 'blue',
    sourceRepoIds: [],
    createdAt: 1,
    updatedAt: 1
  }
  const runtime = {
    getRuntimeId: () => 'runtime-a',
    isDesktopPrimaryAuthority: () => false,
    listProjects: () => [project],
    bindPrimaryAuthorityFingerprint: vi.fn(async (_id: string, fingerprint: string) => {
      project.primaryAuthorityFingerprint = fingerprint
      return project
    }),
    applyPrimaryAuthoritySnapshot: vi.fn(
      async (input: {
        projectId: string
        fingerprint: string
        primaryWorkspace: Project['primaryWorkspace']
        revision: number
      }) => {
        project.primaryAuthorityFingerprint = input.fingerprint
        project.primaryWorkspace = input.primaryWorkspace
        project.primaryWorkspaceRevision = input.revision
        return project
      }
    )
  }
  return { runtime, project }
}

function request(method: string, params: unknown, id = method): RpcRequest {
  return { id, authToken: 'auth', method, params }
}

const authenticated = {
  connectionId: 'connection-a',
  clientKind: 'runtime' as const,
  clientCapabilities: [PROJECT_PRIMARY_AUTHORITY_RUNTIME_CAPABILITY],
  authenticatedCallerFingerprint: peerFingerprint
}

describe('project primary authority RPC', () => {
  it('authenticates attachment, persists initial snapshot, forwards set, and fences stale results', async () => {
    const { runtime } = createRuntime()
    const dispatcher = new RpcDispatcher({ runtime: runtime as never, methods: ALL_RPC_METHODS })
    const controller = new AbortController()
    const frames: { ok: boolean; result?: ProjectPrimaryAuthorityEvent }[] = []
    const stream = dispatcher.dispatchStreaming(
      request('project.primary.authority.attach', { projectIds: [projectId] }),
      (raw) => frames.push(JSON.parse(raw)),
      { ...authenticated, signal: controller.signal }
    )

    await vi.waitFor(() => expect(frames[0]?.result?.type).toBe('request'))
    const snapshotRequest = frames[0]!.result as Extract<
      ProjectPrimaryAuthorityEvent,
      { type: 'request' }
    >
    expect(snapshotRequest.operation).toBe('snapshot')
    const initial = await dispatcher.dispatch(
      request('project.primary.authority.requestResult', {
        requestId: snapshotRequest.requestId,
        epoch: snapshotRequest.epoch,
        generation: snapshotRequest.generation,
        projectId,
        ok: true,
        revision: 0,
        primaryAuthorityFingerprint: peerFingerprint
      }),
      authenticated
    )
    expect(initial).toMatchObject({ ok: true, result: { accepted: true } })
    await vi.waitFor(() =>
      expect(frames.some((frame) => frame.result?.type === 'ready')).toBe(true)
    )
    expect(runtime.applyPrimaryAuthoritySnapshot).toHaveBeenCalledWith({
      projectId,
      fingerprint: peerFingerprint,
      primaryWorkspace: undefined,
      revision: 0
    })

    const registry = getProjectPrimaryAuthorityRegistry(runtime)
    const setting = registry.forwardSet(projectId, { projectId, worktree: 'id:repo-a::/repo-a' })
    await vi.waitFor(() =>
      expect(
        frames.some((frame) => frame.result?.type === 'request' && frame.result.operation === 'set')
      ).toBe(true)
    )
    const setRequest = frames.find(
      (frame) => frame.result?.type === 'request' && frame.result.operation === 'set'
    )!.result as Extract<ProjectPrimaryAuthorityEvent, { type: 'request' }>
    expect(setRequest).toMatchObject({ selector: 'id:repo-a::/repo-a', projectId })
    const setResponse = await dispatcher.dispatch(
      request('project.primary.authority.requestResult', {
        requestId: setRequest.requestId,
        epoch: setRequest.epoch,
        generation: setRequest.generation,
        projectId,
        ok: true,
        revision: 1,
        primaryAuthorityFingerprint: peerFingerprint,
        primaryWorkspace: {
          worktreeId: 'repo-a::/repo-a',
          instanceId: 'instance-a',
          hostId: 'local',
          path: '/repo-a',
          peerFingerprint,
          authorityFingerprint: peerFingerprint
        }
      }),
      authenticated
    )
    expect(setResponse).toMatchObject({ ok: true, result: { accepted: true } })
    await expect(setting).resolves.toMatchObject({
      primaryWorkspace: { instanceId: 'instance-a' },
      primaryWorkspaceRevision: 1
    })
    const ready = frames.find((frame) => frame.result?.type === 'ready')!.result as Extract<
      ProjectPrimaryAuthorityEvent,
      { type: 'ready' }
    >
    const peerSnapshot = await dispatcher.dispatch(
      request('project.primary.authority.requestResult', {
        kind: 'snapshot',
        epoch: ready.epoch,
        generation: ready.generation,
        projectId,
        primaryAuthorityFingerprint: peerFingerprint,
        revision: 1,
        primaryWorkspace: {
          worktreeId: 'repo-a::/repo-a',
          instanceId: 'instance-a',
          hostId: 'local',
          path: '/repo-a',
          peerFingerprint,
          authorityFingerprint: peerFingerprint
        }
      }),
      authenticated
    )
    expect(peerSnapshot).toMatchObject({ ok: true, result: { accepted: true } })

    const stale = await dispatcher.dispatch(
      request('project.primary.authority.requestResult', {
        requestId: 'stale',
        epoch: setRequest.epoch,
        generation: setRequest.generation + 1,
        projectId,
        ok: true,
        revision: 2,
        primaryAuthorityFingerprint: peerFingerprint
      }),
      authenticated
    )
    expect(stale).toMatchObject({ ok: true, result: { accepted: false } })
    controller.abort()
    await stream
  })

  it('rejects unsupported or unauthenticated attachment and conflicting desktop binding', async () => {
    const { runtime } = createRuntime()
    const dispatcher = new RpcDispatcher({ runtime: runtime as never, methods: ALL_RPC_METHODS })
    const missingCapability = await dispatcher.dispatchStreaming(
      request('project.primary.authority.attach', { projectIds: [projectId] }),
      (raw) => expect(JSON.parse(raw)).toMatchObject({ ok: false }),
      { ...authenticated, clientCapabilities: [] }
    )
    await missingCapability
    expect(runtime.bindPrimaryAuthorityFingerprint).not.toHaveBeenCalled()

    const conflictRuntime = createRuntime().runtime
    conflictRuntime.bindPrimaryAuthorityFingerprint.mockRejectedValue(
      new Error('primary_authority_conflict')
    )
    const conflictDispatcher = new RpcDispatcher({
      runtime: conflictRuntime as never,
      methods: ALL_RPC_METHODS
    })
    const errors: unknown[] = []
    await conflictDispatcher.dispatchStreaming(
      request('project.primary.authority.attach', { projectIds: [projectId] }),
      (raw) => errors.push(JSON.parse(raw)),
      authenticated
    )
    expect(errors).toMatchObject([{ ok: false, error: { message: 'primary_authority_conflict' } }])
  })

  it('rejects snapshots when the desktop authority has no active attachment', async () => {
    const { runtime, project } = createRuntime()
    project.primaryAuthorityFingerprint = peerFingerprint
    const dispatcher = new RpcDispatcher({ runtime: runtime as never, methods: ALL_RPC_METHODS })
    const snapshot = {
      kind: 'snapshot',
      epoch: 'active-epoch',
      generation: 1,
      projectId,
      primaryAuthorityFingerprint: peerFingerprint,
      revision: 3,
      primaryWorkspace: {
        worktreeId: 'repo-a::/repo-a',
        instanceId: 'instance-a',
        hostId: 'local',
        path: '/repo-a',
        peerFingerprint,
        authorityFingerprint: peerFingerprint
      }
    }
    await expect(
      dispatcher.dispatch(
        request('project.primary.authority.requestResult', snapshot),
        authenticated
      )
    ).resolves.toMatchObject({ ok: true, result: { accepted: false } })
    await expect(
      dispatcher.dispatch(
        request('project.primary.authority.requestResult', {
          ...snapshot,
          primaryAuthorityFingerprint: 'other-desktop'
        }),
        authenticated
      )
    ).resolves.toMatchObject({ ok: true, result: { accepted: false } })
  })

  it('prevalidates every project binding before persisting an attachment batch', async () => {
    const { runtime, project } = createRuntime()
    const secondProject: Project = {
      ...project,
      id: 'project-b',
      primaryAuthorityFingerprint: 'other-desktop'
    }
    runtime.listProjects = () => [project, secondProject]
    const dispatcher = new RpcDispatcher({ runtime: runtime as never, methods: ALL_RPC_METHODS })
    const errors: unknown[] = []
    await dispatcher.dispatchStreaming(
      request('project.primary.authority.attach', { projectIds: [projectId, secondProject.id] }),
      (raw) => errors.push(JSON.parse(raw)),
      authenticated
    )
    expect(errors).toMatchObject([{ ok: false, error: { message: 'primary_authority_conflict' } }])
    expect(runtime.bindPrimaryAuthorityFingerprint).not.toHaveBeenCalled()
  })
})
