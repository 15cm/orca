import { describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const state = vi.hoisted(() => ({
  environments: [] as { id: string; pairingRevision: number; createdAt: number }[],
  fingerprints: new Map<string, string>(),
  disconnected: new Set<string>(),
  links: new Map<string, { dispatcher: unknown; capabilities: string[] }>(),
  rosters: new Map<string, string[]>(),
  subscribe: vi.fn(),
  call: vi.fn()
}))

const electronMocks = vi.hoisted(() => ({
  BrowserWindow: { fromId: vi.fn(() => null) },
  webContents: { fromId: vi.fn(() => null) },
  ipcMain: { on: vi.fn(), removeListener: vi.fn() },
  app: { getPath: vi.fn(() => '/tmp'), isPackaged: false }
}))
vi.mock('electron', () => electronMocks)

vi.mock('../../shared/runtime-environment-store', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    listEnvironments: () => state.environments,
    resolveEnvironment: (_path: string, id: string) => {
      const environment = state.environments.find((entry) => entry.id === id)
      if (!environment) {
        throw new Error('environment_not_found')
      }
      return environment
    }
  }
})

vi.mock('../../shared/runtime-environments', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    getPreferredPairingOffer: (environment: { id: string }) => ({
      publicKeyB64: state.fingerprints.get(environment.id) ?? 'desktop-fingerprint',
      endpoint: 'ws://127.0.0.1:6768'
    })
  }
})

vi.mock('../runtime/peer-fingerprint', () => ({
  fingerprintPeerPublicKey: (key: string) => key
}))

vi.mock('./runtime-environment-connectivity-handlers', () => ({
  isRuntimeEnvironmentManuallyDisconnected: (id: string) => state.disconnected.has(id)
}))

vi.mock('./runtime-environment-transport-routing', () => ({
  subscribeRuntimeEnvironment: state.subscribe,
  callRuntimeEnvironment: state.call
}))

import { PROJECT_PRIMARY_AUTHORITY_RUNTIME_CAPABILITY } from '../../shared/protocol-version'
import { createStore, testState, writeDataFile } from '../persistence-test-harness'
import type { Project, ProjectPrimarySelector } from '../../shared/project-types'
import { notifyProjectPrimaryAuthorityChanged } from '../runtime/project-primary-authority-notifier'
import { getProjectPrimaryAuthorityRegistry } from '../runtime/project-primary-authority-registry'
import { mainProcessState } from '../startup/main-process-state'
import { RpcDispatcher } from '../runtime/rpc/dispatcher'
import type { RpcRequest } from '../runtime/rpc/core'
import { ALL_RPC_METHODS } from '../runtime/rpc/methods'
import { listAuthenticatedProjectPeerWorktrees } from './project-primary-authority-peer-catalog'
import { RuntimeProjectPrimaryWorkspaceController } from '../runtime/runtime-project-primary-workspace-controller'
import { RuntimeProjectPrimaryRemovalController } from '../runtime/runtime-project-primary-removal-controller'
import { startProjectPrimaryAuthoritySubscriptions } from './project-primary-authority-subscriptions'

const projectId = 'project-primary-transport'
const desktopFingerprint = 'desktop-fingerprint'
const userDataPath = '/task/project-primary-authority'

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: projectId,
    displayName: 'Transport Project',
    badgeColor: '#000',
    sourceRepoIds: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

function request(method: string, params: unknown): RpcRequest {
  return { id: `${method}-request`, authToken: 'test-auth', method, params }
}

type Peer = {
  project: Project
  projects: Project[]
  runtime: object
  dispatcher: RpcDispatcher
  context: {
    clientKind: 'runtime'
    clientCapabilities: string[]
    connectionId: string
    authenticatedCallerFingerprint: string
  }
}

function createPeer(savedProjects = [project()]): Peer {
  const runtime = {
    getRuntimeId: () => `runtime-${Math.random()}`,
    isDesktopPrimaryAuthority: () => false,
    listProjects: () => savedProjects,
    bindPrimaryAuthorityFingerprint: async (id: string, fingerprint: string) => {
      const savedProject = savedProjects.find((entry) => entry.id === id)
      if (!savedProject) {
        throw new Error('project_not_found')
      }
      if (
        savedProject.primaryAuthorityFingerprint &&
        savedProject.primaryAuthorityFingerprint !== fingerprint
      ) {
        throw new Error('primary_authority_conflict')
      }
      savedProject.primaryAuthorityFingerprint = fingerprint
      return savedProject
    },
    applyPrimaryAuthoritySnapshot: async (input: {
      projectId: string
      fingerprint: string
      primaryWorkspace: Project['primaryWorkspace']
      revision: number
    }) => {
      const savedProject = savedProjects.find((entry) => entry.id === input.projectId)
      if (!savedProject || savedProject.primaryAuthorityFingerprint !== input.fingerprint) {
        throw new Error('primary_authority_conflict')
      }
      const currentRevision = savedProject.primaryWorkspaceRevision ?? 0
      if (!Number.isSafeInteger(input.revision) || input.revision < currentRevision) {
        throw new Error('stale_primary_authority_snapshot')
      }
      if (
        input.revision === currentRevision &&
        JSON.stringify(savedProject.primaryWorkspace) !== JSON.stringify(input.primaryWorkspace)
      ) {
        throw new Error('conflicting_primary_authority_snapshot')
      }
      savedProject.primaryWorkspace = input.primaryWorkspace
      savedProject.primaryWorkspaceRevision = input.revision
      return savedProject
    }
  }
  return {
    project: savedProjects[0]!,
    projects: savedProjects,
    runtime,
    dispatcher: new RpcDispatcher({ runtime: runtime as never, methods: ALL_RPC_METHODS }),
    context: {
      clientKind: 'runtime',
      clientCapabilities: [PROJECT_PRIMARY_AUTHORITY_RUNTIME_CAPABILITY],
      connectionId: `desktop-connection-${randomUUID()}`,
      authenticatedCallerFingerprint: desktopFingerprint
    }
  }
}

function installRpcTransport(): void {
  let requestId = 0
  state.subscribe.mockImplementation(
    async (
      _userDataPath: string,
      environmentId: string,
      method: string,
      params: unknown,
      _timeoutMs: number,
      callbacks: {
        onEvent: (event: {
          type: 'response' | 'error' | 'close'
          response?: { ok: boolean; result?: unknown; error?: { message?: string } }
          message?: string
          code?: string
        }) => void
        onClose: () => void
      }
    ) => {
      const link = state.links.get(environmentId)
      if (!link) {
        throw new Error('test_link_not_found')
      }
      const peer = link.dispatcher as Peer['dispatcher']
      const abortController = new AbortController()
      const context: Peer['context'] = {
        clientKind: 'runtime',
        clientCapabilities: link.capabilities,
        connectionId: `desktop-${environmentId}-${++requestId}`,
        authenticatedCallerFingerprint: desktopFingerprint
      }
      const stream = peer.dispatchStreaming(
        request(method, params),
        (raw) => {
          const response = JSON.parse(raw) as {
            ok: boolean
            result?: unknown
            error?: { message?: string }
          }
          callbacks.onEvent(
            response.ok
              ? { type: 'response', response }
              : { type: 'error', code: 'rpc_error', message: response.error?.message }
          )
        },
        { ...context, signal: abortController.signal }
      )
      void stream.then(() => callbacks.onClose())
      return {
        requestId: `subscription-${requestId}`,
        sendBinary: () => true,
        close: () => {
          abortController.abort()
          callbacks.onEvent({ type: 'close' })
        },
        sendRequest: async (requestMethod: string, requestParams: unknown) => {
          const response = await peer.dispatch(request(requestMethod, requestParams), context)
          return response
        }
      }
    }
  )
  state.call.mockImplementation(async (_path: string, environmentId: string) => ({
    id: 'project.list',
    ok: true,
    result: {
      projects: (state.rosters.get(environmentId) ?? []).map((id) => ({ id }))
    },
    _meta: { runtimeId: `runtime-${environmentId}` }
  }))
}

function createDesktopRuntime(savedProjects: Project[]) {
  return {
    isDesktopPrimaryAuthority: () => true,
    getOwnPeerFingerprint: () => desktopFingerprint,
    bindPrimaryAuthorityFingerprint: async (id: string, fingerprint: string) => {
      const savedProject = savedProjects.find((entry) => entry.id === id)
      if (!savedProject) {
        throw new Error('project_not_found')
      }
      if (
        savedProject.primaryAuthorityFingerprint &&
        savedProject.primaryAuthorityFingerprint !== fingerprint
      ) {
        throw new Error('primary_authority_conflict')
      }
      savedProject.primaryAuthorityFingerprint = fingerprint
      return savedProject
    },
    setPrimaryWorkspace: async (args: { projectId: string; worktree: string }) => {
      const savedProject = savedProjects.find((entry) => entry.id === args.projectId)
      if (!savedProject || args.worktree !== 'id:repo-a::/repo-a') {
        throw new Error('primary_workspace_unavailable')
      }
      savedProject.primaryWorkspace = {
        worktreeId: 'repo-a::/repo-a',
        instanceId: 'instance-a',
        hostId: 'local',
        path: '/repo-a',
        peerFingerprint: 'owner-fingerprint',
        authorityFingerprint: desktopFingerprint
      }
      savedProject.primaryWorkspaceRevision = (savedProject.primaryWorkspaceRevision ?? 0) + 1
      notifyProjectPrimaryAuthorityChanged(savedProject)
      return savedProject
    }
  }
}

describe('desktop project primary authority subscriber transport', () => {
  it('forwards remote set through desktop persistence and broadcasts snapshot to a second peer', async () => {
    const desktopProject = project()
    const secondaryProjectId = 'project-primary-secondary'
    const desktopProjectB = project({ id: secondaryProjectId, displayName: 'Secondary Project' })
    const peerProjectB = project({ id: secondaryProjectId, displayName: 'Secondary Project' })
    const peerA = createPeer([project(), peerProjectB])
    const peerB = createPeer()
    state.environments = [
      { id: 'peer-a', pairingRevision: 1, createdAt: 1 },
      { id: 'peer-b', pairingRevision: 1, createdAt: 1 }
    ]
    state.fingerprints = new Map([
      ['peer-a', 'peer-a-fingerprint'],
      ['peer-b', 'peer-b-fingerprint']
    ])
    state.disconnected.clear()
    state.links = new Map([
      [
        'peer-a',
        {
          dispatcher: peerA.dispatcher,
          capabilities: [PROJECT_PRIMARY_AUTHORITY_RUNTIME_CAPABILITY]
        }
      ],
      [
        'peer-b',
        {
          dispatcher: peerB.dispatcher,
          capabilities: [PROJECT_PRIMARY_AUTHORITY_RUNTIME_CAPABILITY]
        }
      ]
    ])
    state.rosters = new Map([
      ['peer-a', [projectId]],
      ['peer-b', [projectId]]
    ])
    installRpcTransport()
    mainProcessState.runtime = createDesktopRuntime([desktopProject, desktopProjectB]) as never
    const store = { getProjects: () => [desktopProject, desktopProjectB] }
    await startProjectPrimaryAuthoritySubscriptions(store as never, userDataPath)

    await vi.waitFor(() => {
      expect(peerA.project.primaryAuthorityFingerprint).toBe(desktopFingerprint)
      expect(peerB.project.primaryAuthorityFingerprint).toBe(desktopFingerprint)
    })
    const peerRegistryA = getProjectPrimaryAuthorityRegistry(peerA.runtime)
    const peerRegistryB = getProjectPrimaryAuthorityRegistry(peerB.runtime)
    await vi.waitFor(() => {
      expect(peerRegistryA.getAttachment(projectId)?.active).toBe(true)
      expect(peerRegistryB.getAttachment(projectId)?.active).toBe(true)
    })
    const result = peerRegistryA.forwardSet(projectId, {
      projectId,
      worktree: 'id:repo-a::/repo-a'
    })
    await expect(result).resolves.toMatchObject({
      primaryWorkspace: { instanceId: 'instance-a' },
      primaryWorkspaceRevision: 1
    })
    await vi.waitFor(() => expect(peerB.project.primaryWorkspaceRevision).toBe(1))
    expect(desktopProject.primaryWorkspaceRevision).toBe(1)
    expect(peerA.project.primaryWorkspace?.worktreeId).toBe('repo-a::/repo-a')
    expect(peerB.project.primaryWorkspace?.worktreeId).toBe('repo-a::/repo-a')

    const attachmentB = peerRegistryB.getAttachment(projectId)!
    const stale = await peerB.dispatcher.dispatch(
      request('project.primary.authority.requestResult', {
        kind: 'snapshot',
        epoch: attachmentB.epoch,
        generation: attachmentB.generation,
        projectId,
        primaryAuthorityFingerprint: desktopFingerprint,
        revision: 0
      }),
      {
        clientKind: 'runtime',
        clientCapabilities: [PROJECT_PRIMARY_AUTHORITY_RUNTIME_CAPABILITY],
        connectionId: attachmentB.connectionId,
        authenticatedCallerFingerprint: desktopFingerprint
      }
    )
    expect(stale.ok).toBe(false)
    expect(peerB.project.primaryWorkspaceRevision).toBe(1)

    state.rosters.set('peer-a', [projectId, secondaryProjectId])
    await startProjectPrimaryAuthoritySubscriptions(store as never, userDataPath)
    await vi.waitFor(() => {
      expect(peerA.projects[1]?.primaryAuthorityFingerprint).toBe(desktopFingerprint)
      expect(peerRegistryA.getAttachment(secondaryProjectId)?.active).toBe(true)
    })
    const secondarySet = peerRegistryA.forwardSet(secondaryProjectId, {
      projectId: secondaryProjectId,
      worktree: 'id:repo-a::/repo-a'
    })
    await expect(secondarySet).resolves.toMatchObject({ primaryWorkspaceRevision: 1 })
    expect(peerA.projects[1]?.primaryWorkspaceRevision).toBe(1)

    const priorConnectionId = peerRegistryA.getAttachment(projectId)?.connectionId
    state.fingerprints.set('peer-a', 'peer-a-repaired-fingerprint')
    await startProjectPrimaryAuthoritySubscriptions(store as never, userDataPath)
    await vi.waitFor(() => {
      const attachment = peerRegistryA.getAttachment(projectId)
      expect(attachment?.active).toBe(true)
      expect(attachment?.connectionId).not.toBe(priorConnectionId)
    })

    state.disconnected.add('peer-a')
    await startProjectPrimaryAuthoritySubscriptions(store as never, userDataPath)
    await vi.waitFor(() => expect(Boolean(peerRegistryA.getAttachment(projectId)?.active)).toBe(false))
    state.disconnected.delete('peer-a')
    await startProjectPrimaryAuthoritySubscriptions(store as never, userDataPath)
    await vi.waitFor(() => expect(peerRegistryA.getAttachment(projectId)?.active).toBe(true))
  })

  it('persists subscriber selection through the real Store and workspace controller', async () => {
    testState.dir = mkdtempSync(join(tmpdir(), 'orca-primary-subscriber-store-'))
    writeDataFile({
      schemaVersion: 1,
      repos: [],
      projects: [],
      projectHostSetups: [],
      projectGroups: [],
      folderWorkspaces: [],
      worktreeMeta: {},
      settings: {},
      ui: {},
      githubCache: { pr: {}, issue: {} },
      worktreeLineageById: {},
      workspaceLineageByChildKey: {}
    })
    state.environments = [{ id: 'peer-a', pairingRevision: 1, createdAt: 1 }]
    state.fingerprints = new Map([['peer-a', 'peer-a-fingerprint']])
    state.disconnected.clear()
    const peerA = createPeer()
    state.links = new Map([
      [
        'peer-a',
        {
          dispatcher: peerA.dispatcher,
          capabilities: [PROJECT_PRIMARY_AUTHORITY_RUNTIME_CAPABILITY]
        }
      ]
    ])
    state.rosters = new Map([['peer-a', [projectId]]])
    installRpcTransport()
    const remoteProject = project({ sourceRepoIds: ['repo-a'] })
    const remoteSetup = {
      id: 'setup-a',
      projectId,
      repoId: 'repo-a',
      hostId: 'local',
      path: '/repo-a',
      displayName: 'repo-a',
      setupState: 'ready',
      setupMethod: 'cloned',
      createdAt: 1,
      updatedAt: 1
    }
    const sshSetup = {
      ...remoteSetup,
      id: 'setup-ssh',
      hostId: 'ssh:connection-1'
    }
    state.call.mockImplementation(
      async (_path: string, environmentId: string, method: string) => {
        const result =
          method === 'project.list'
            ? { projects: [remoteProject] }
            : method === 'projectHostSetup.list'
              ? { setups: [remoteSetup, sshSetup] }
              : {
                  repoId: 'repo-a',
                  authoritative: true,
                  source: 'detected',
                  worktrees: [
                    {
                      id: 'repo-a::/repo-a-worktree',
                      repoId: 'repo-a',
                      path: '/repo-a-worktree',
                      instanceId: 'instance-local-child',
                      peerFingerprint: 'peer-a-fingerprint',
                      ownerHostId: 'local',
                      head: 'head-local-child',
                      branch: 'child',
                      isBare: false,
                      isMainWorktree: false
                    },
                    {
                      id: 'repo-a::/repo-a',
                      repoId: 'repo-a',
                      path: '/repo-a',
                      instanceId: 'instance-a',
                      peerFingerprint: 'peer-a-fingerprint',
                      ownerHostId: 'local',
                      head: 'head-a',
                      branch: 'main',
                      isBare: false,
                      isMainWorktree: true
                    },
                    {
                      id: 'repo-a::/repo-a',
                      repoId: 'repo-a',
                      path: '/repo-a',
                      instanceId: 'instance-ssh-a',
                      peerFingerprint: 'peer-a-fingerprint',
                      ownerHostId: 'ssh:connection-1',
                      head: 'head-ssh-a',
                      branch: 'main',
                      isBare: false,
                      isMainWorktree: false
                    }
                  ]
                }
        return { id: method, ok: true, result, _meta: { runtimeId: `runtime-${environmentId}` } }
      }
    )

    const store = createStore()
    state.call.mockClear()
    const primaryRemoval = new RuntimeProjectPrimaryRemovalController({
      getStore: () => store,
      isDesktopAuthority: () => true,
      listResolvedWorktrees: async () => [
        {
          id: 'repo-a::/repo-a',
          repoId: 'repo-a',
          hostId: 'ssh:connection-1',
          ownerHostId: 'ssh:connection-1',
          instanceId: 'desktop-ssh-collision',
          path: '/repo-a',
          peerFingerprint: desktopFingerprint,
          isArchived: false,
          git: { isBare: false, prunable: false, isMainWorktree: false }
        } as never
      ],
      listAuthenticatedRuntimeWorktrees: (id, environmentId) =>
        listAuthenticatedProjectPeerWorktrees(store, userDataPath, id, environmentId),
      verifyAuthoritativeWorktree: async () => true,
      getOwnPeerFingerprint: () => desktopFingerprint
    })
    const controller = new RuntimeProjectPrimaryWorkspaceController({
      getStore: () => store,
      listProjects: () => store.getProjects(),
      listSetups: () => store.getProjectHostSetups(),
      listResolvedWorktrees: async () => [
        {
          id: 'repo-a::/repo-a',
          repoId: 'repo-a',
          hostId: 'ssh:connection-1',
          ownerHostId: 'ssh:connection-1',
          instanceId: 'desktop-ssh-collision',
          path: '/repo-a',
          peerFingerprint: desktopFingerprint,
          isArchived: false,
          git: { isBare: false, prunable: false, isMainWorktree: false }
        } as never
      ],
      listAuthenticatedRuntimeWorktrees: (id, environmentId) =>
        listAuthenticatedProjectPeerWorktrees(store, userDataPath, id, environmentId),
      verifyAuthoritativeWorktree: async () => true,
      getOwnPeerFingerprint: () => desktopFingerprint,
      isDesktopAuthority: () => true,
      runPrimaryMutation: (id, target, operation) =>
        primaryRemoval.runPrimaryMutation(id, target, operation),
      flushPrimaryPersistence: () => store.flushPendingOrThrowAsync(),
      invalidateResolvedWorktrees: () => undefined,
      notifyReposChanged: () => undefined
    })
    mainProcessState.runtime = {
      isDesktopPrimaryAuthority: () => true,
      getOwnPeerFingerprint: () => desktopFingerprint,
      bindPrimaryAuthorityFingerprint: (id: string, fingerprint: string) =>
        store.bindPrimaryAuthorityFingerprintDurably(id, fingerprint),
      setPrimaryWorkspace: (args: ProjectPrimarySelector) => controller.set(args),
      setPrimaryWorkspaceForPeer: (args: ProjectPrimarySelector, environmentId: string) =>
        controller.setWithAuthenticatedPeer(args, environmentId)
    } as never

    try {
      expect(state.environments.map((entry) => entry.id)).toEqual(['peer-a'])
      expect(state.disconnected.size).toBe(0)
      expect((mainProcessState.runtime as { isDesktopPrimaryAuthority: () => boolean }).isDesktopPrimaryAuthority()).toBe(true)
      await startProjectPrimaryAuthoritySubscriptions(store, userDataPath)
      expect(state.call.mock.calls.map(([, , method]) => method)).toEqual([
        'project.list',
        'projectHostSetup.list',
        'worktree.detectedList',
        'worktree.detectedList',
        'worktree.detectedList'
      ])
      expect(store.getProjects()).toHaveLength(1)
      expect(store.getProjects()[0]).toMatchObject({
        primaryWorkspace: {
          worktreeId: 'repo-a::/repo-a',
          hostId: 'local',
          peerFingerprint: 'peer-a-fingerprint',
          authorityFingerprint: desktopFingerprint
        },
        primaryWorkspaceRevision: 1
      })
      const peerRegistry = getProjectPrimaryAuthorityRegistry(peerA.runtime)
      await vi.waitFor(() => expect(peerRegistry.getAttachment(projectId)?.active).toBe(true))
      await vi.waitFor(() => expect(peerA.project.primaryWorkspaceRevision).toBe(1))
      await expect(
        peerRegistry.forwardSet(projectId, {
          projectId,
          worktree: 'id:repo-a::/repo-a-worktree',
          hostId: 'local'
        })
      ).resolves.toMatchObject({
        primaryWorkspace: {
          worktreeId: 'repo-a::/repo-a-worktree',
          instanceId: 'instance-local-child',
          peerFingerprint: 'peer-a-fingerprint',
          authorityFingerprint: desktopFingerprint
        },
        primaryWorkspaceRevision: 2
      })
      await expect(
        peerRegistry.forwardSet(projectId, {
          projectId,
          worktree: 'id:repo-a::/repo-a',
          hostId: 'ssh:connection-1'
        })
      ).resolves.toMatchObject({
        primaryWorkspace: {
          worktreeId: 'repo-a::/repo-a',
          hostId: 'ssh:connection-1',
          instanceId: 'instance-ssh-a',
          peerFingerprint: 'peer-a-fingerprint',
          authorityFingerprint: desktopFingerprint
        },
        primaryWorkspaceRevision: 3
      })
      await store.flushPendingOrThrowAsync()
      const reloaded = createStore()
      expect(reloaded.getProjects()).toMatchObject([
        {
          id: projectId,
          primaryAuthorityFingerprint: desktopFingerprint,
          primaryWorkspace: { worktreeId: 'repo-a::/repo-a', hostId: 'ssh:connection-1' },
          primaryWorkspaceRevision: 3
        }
      ])
      expect(reloaded.getRepos()).toEqual([])

    } finally {
      state.environments = []
      await startProjectPrimaryAuthoritySubscriptions(store, userDataPath)
      await store.flushPendingOrThrowAsync()
      rmSync(testState.dir, { recursive: true, force: true })
    }
  })
})
