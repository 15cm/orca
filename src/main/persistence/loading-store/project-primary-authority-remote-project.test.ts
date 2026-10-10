import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const electronMocks = vi.hoisted(() => ({
  BrowserWindow: { fromId: vi.fn(() => null) },
  webContents: { fromId: vi.fn(() => null) },
  ipcMain: { on: vi.fn(), removeListener: vi.fn() },
  app: { getPath: vi.fn(() => '/tmp'), isPackaged: false }
}))
vi.mock('electron', () => electronMocks)

import { createStore, testState, writeDataFile } from '../../persistence-test-harness'

describe('remote primary authority project compatibility persistence', () => {
  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'orca-primary-remote-project-'))
  })

  afterEach(() => {
    rmSync(testState.dir, { recursive: true, force: true })
  })

  it('retains an authority-bound remote project and setup across Store reload without a fake Repo', async () => {
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
    const store = createStore()
    store.registerRemoteProjectAuthorityCompatibility({
      authorityFingerprint: 'desktop-peer',
      runtimeOwnerFingerprint: 'peer-a',
      hostId: 'runtime:peer-a',
      remoteProject: {
        id: 'remote-project',
        displayName: 'Remote project',
        badgeColor: '#123456',
        sourceRepoIds: ['remote-repo'],
        createdAt: 1,
        updatedAt: 2,
        primaryWorkspace: {
          worktreeId: 'remote-repo::/main',
          instanceId: 'untrusted-instance',
          hostId: 'local',
          path: '/main',
          peerFingerprint: 'peer-a',
          authorityFingerprint: 'peer-a'
        }
      },
      setups: [
        {
          id: 'remote-setup',
          projectId: 'remote-project',
          repoId: 'remote-repo',
          hostId: 'local',
          path: '/peer/repo',
          displayName: 'repo',
          setupState: 'ready',
          setupMethod: 'cloned',
          createdAt: 2,
          updatedAt: 3
        }
      ]
    })
    await store.flushPendingOrThrowAsync()

    expect(store.getRepos()).toEqual([])
    expect(store.getProjects()).toMatchObject([
      {
        id: 'remote-project',
        sourceRepoIds: [],
        primaryAuthorityFingerprint: 'desktop-peer'
      }
    ])
    expect(store.getProjects()[0]).not.toHaveProperty('primaryWorkspace')
    expect(store.getProjectHostSetups()).toMatchObject([
      {
        id: 'runtime:peer-a::remote-setup',
        projectId: 'remote-project',
        repoId: 'remote-repo',
        hostId: 'runtime:peer-a',
        runtimeOwnerEnvironmentId: 'peer-a',
        runtimeOwnerFingerprint: 'peer-a',
        runtimeOwnerHostId: 'local'
      }
    ])

    const reloaded = createStore()
    expect(reloaded.getProjects()[0]?.primaryAuthorityFingerprint).toBe('desktop-peer')
    expect(reloaded.getProjectHostSetups()[0]?.hostId).toBe('runtime:peer-a')
    expect(reloaded.getRepos()).toEqual([])
  })

  it('rejects another desktop binding without replacing a saved choice', async () => {
    const store = createStore()
    store.registerRemoteProjectAuthorityCompatibility({
      authorityFingerprint: 'desktop-a',
      hostId: 'runtime:peer-a',
      remoteProject: {
        id: 'remote-project',
        displayName: 'Remote project',
        badgeColor: '#123456',
        sourceRepoIds: [],
        createdAt: 1,
        updatedAt: 2
      },
      setups: []
    })
    store.setPrimaryWorkspace('remote-project', {
      worktreeId: 'remote-repo::/main',
      instanceId: 'instance-a',
      hostId: 'local',
      path: '/main',
      peerFingerprint: 'peer-a',
      authorityFingerprint: 'desktop-a'
    })
    expect(() =>
      store.registerRemoteProjectAuthorityCompatibility({
        authorityFingerprint: 'desktop-b',
        hostId: 'runtime:peer-b',
        remoteProject: {
          id: 'remote-project',
          displayName: 'Remote project from peer',
          badgeColor: '#fff',
          sourceRepoIds: [],
          createdAt: 1,
          updatedAt: 3
        },
        setups: []
      })
    ).toThrow('primary_authority_conflict')
    expect(store.getProjects()[0]).toMatchObject({
      primaryAuthorityFingerprint: 'desktop-a',
      primaryWorkspace: { instanceId: 'instance-a' }
    })
  })

  it('rolls back remote registration when its durable flush fails', async () => {
    const store = createStore()
    const flush = store.flushPendingOrThrowAsync.bind(store)
    let rejectFirstFlush = true
    store.flushPendingOrThrowAsync = async () => {
      if (rejectFirstFlush) {
        rejectFirstFlush = false
        throw new Error('disk_full')
      }
      return flush()
    }

    await expect(
      store.registerRemoteProjectAuthorityCompatibilityDurably({
        authorityFingerprint: 'desktop-a',
        hostId: 'runtime:peer-a',
        remoteProject: {
          id: 'remote-project',
          displayName: 'Remote project',
          badgeColor: '#123456',
          sourceRepoIds: [],
          createdAt: 1,
          updatedAt: 2
        },
        setups: [
          {
            id: 'setup-a',
            projectId: 'remote-project',
            repoId: 'repo-a',
            hostId: 'local',
            path: '/repo-a',
            displayName: 'repo-a',
            setupState: 'ready',
            setupMethod: 'cloned',
            createdAt: 1,
            updatedAt: 1
          }
        ]
      })
    ).rejects.toThrow('disk_full')
    const reloaded = createStore()
    expect(reloaded.getProjects()).toEqual([])
    expect(reloaded.getProjectHostSetups()).toEqual([])
  })
})
