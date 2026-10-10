import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const electronMocks = vi.hoisted(() => {
  const ipcMain = { on: vi.fn(() => ipcMain), removeListener: vi.fn(() => ipcMain) }
  return {
    BrowserWindow: { fromId: vi.fn(() => null) },
    webContents: { fromId: vi.fn(() => null) },
    ipcMain,
    app: { getPath: vi.fn(() => '/tmp'), isPackaged: false }
  }
})
vi.mock('electron', () => electronMocks)

import {
  makeProject,
  makeProjectHostSetup,
  makeRepo,
  createStore,
  testState,
  writeDataFile
} from '../persistence-test-harness'
import { OrcaRuntimeService } from './orca-runtime'
import type { Worktree } from '../../shared/worktree/types'

describe('project primary workspace lifecycle Store integration', () => {
  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'orca-primary-lifecycle-store-'))
  })

  afterEach(() => {
    rmSync(testState.dir, { recursive: true, force: true })
  })

  it('binds and seeds a fresh registered project through the runtime lifecycle with durable Store state', async () => {
    const repo = makeRepo({ id: 'repo-a', path: '/registered/repo-a' })
    const project = makeProject({ id: `repo:${repo.id}`, sourceRepoIds: [repo.id] })
    const setup = makeProjectHostSetup({
      id: 'setup-a',
      projectId: project.id,
      repoId: repo.id,
      hostId: 'local',
      path: repo.path,
      setupState: 'ready'
    })
    writeDataFile({
      schemaVersion: 1,
      repos: [repo],
      projects: [project],
      projectHostSetups: [setup],
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
    store.setWorktreeMetaForHost(`${repo.id}::${repo.path}`, 'local', {
      instanceId: 'root-instance'
    })
    const runtime = new OrcaRuntimeService(store as never, undefined, {
      getOwnPeerFingerprint: () => 'desktop-peer',
      isDesktopPrimaryAuthority: () => true
    })
    const root: Worktree = {
      id: `${repo.id}::${repo.path}`,
      repoId: repo.id,
      path: repo.path,
      hostId: 'local',
      ownerHostId: 'local',
      peerFingerprint: 'desktop-peer',
      instanceId: 'root-instance',
      head: 'head',
      branch: 'main',
      isBare: false,
      isMainWorktree: true,
      displayName: repo.displayName,
      comment: '',
      linkedIssue: null,
      linkedPR: null,
      linkedLinearIssue: null,
      linkedGitLabMR: null,
      linkedGitLabIssue: null,
      isArchived: false,
      isUnread: false,
      isPinned: false,
      sortOrder: 0,
      lastActivityAt: 0
    }

    await runtime.schedulePrimaryWorkspaceLifecycleFromAuthoritativeCatalog([root], [repo.id], true)
    await vi.waitFor(() => {
      expect(store.getProjects()[0]?.primaryWorkspace?.instanceId).toBe('root-instance')
    })
    await store.flushPendingOrThrowAsync()

    expect(store.getProjects()[0]).toMatchObject({
      primaryAuthorityFingerprint: 'desktop-peer',
      primaryWorkspaceRevision: 1,
      primaryWorkspace: {
        worktreeId: root.id,
        instanceId: root.instanceId,
        peerFingerprint: 'desktop-peer',
        authorityFingerprint: 'desktop-peer'
      }
    })
    const reloaded = createStore()
    expect(reloaded.getProjects()[0]?.primaryWorkspace).toEqual(
      store.getProjects()[0]?.primaryWorkspace
    )
  })
})
