import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { getRuntimeFolderWorkspaceRootId } from '../../../runtime/runtime-folder-workspace'
import { inspectFolderRootPresence } from '../../../runtime/project-primary-owner-verification'
import { resolveProjectPrimaryWorkspace } from '../../../../shared/project-primary-workspace'
import { applyFreshDetectedWorktreeScanSideEffects } from './detected-worktree-scan-cache'
import { fenceObservedMissingPrimaryWorktree } from '../../../runtime/project-primary-workspace-disappearance'
import {
  createStore,
  makeProject,
  makeProjectHostSetup,
  makeRepo,
  testState,
  writeDataFile
} from '../../../persistence-test-harness'

const repo = makeRepo({
  id: 'repo-ssh',
  path: '/remote/repo',
  connectionId: 'target-a'
})
const primary = {
  worktreeId: 'repo-ssh::/remote/removed',
  instanceId: 'instance-a',
  hostId: 'ssh:target-a' as const,
  path: '/remote/removed',
  peerFingerprint: 'test-peer',
  authorityFingerprint: 'desktop-authority'
}

function makeStore() {
  const project = makeProject({
    id: 'project-ssh',
    sourceRepoIds: [repo.id],
    primaryAuthorityFingerprint: 'desktop-authority',
    primaryWorkspaceRevision: 4,
    primaryWorkspace: primary
  })
  const setup = makeProjectHostSetup({
    id: 'setup-ssh',
    projectId: project.id,
    repoId: repo.id,
    hostId: 'ssh:target-a',
    path: repo.path
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
  store.setWorktreeMetaForHost(primary.worktreeId, 'ssh:target-a', {
    instanceId: primary.instanceId
  })
  return store
}

describe('primary workspace observed disappearance fence', () => {
  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'orca-primary-disappearance-'))
  })

  afterEach(() => {
    rmSync(testState.dir, { recursive: true, force: true })
  })

  it('rotates host identity after a successful missing scan and retains unavailable selection after reload', async () => {
    const store = makeStore()
    await store.flushPendingOrThrowAsync()

    await applyFreshDetectedWorktreeScanSideEffects(
      store,
      repo,
      [
        {
          path: '/remote/other',
          head: 'head',
          branch: 'feature',
          isBare: false,
          isMainWorktree: false
        }
      ],
      undefined,
      { ownPeerFingerprint: 'test-peer', hygieneDue: false }
    )
    await store.flushPendingOrThrowAsync()
    const rotated = store.getWorktreeMetaForHost(primary.worktreeId, 'ssh:target-a')?.instanceId

    expect(rotated).toBeTruthy()
    expect(rotated).not.toBe(primary.instanceId)

    const reloaded = createStore()
    const savedProject = reloaded
      .getProjects()
      .find((entry) => entry.sourceRepoIds.includes(repo.id))!
    expect(savedProject.primaryWorkspace).toEqual(primary)
    expect(reloaded.getWorktreeMetaForHost(primary.worktreeId, 'ssh:target-a')?.instanceId).toBe(
      rotated
    )

    const recreated = {
      id: primary.worktreeId,
      repoId: repo.id,
      path: primary.path,
      hostId: primary.hostId,
      ownerHostId: primary.hostId,
      peerFingerprint: 'test-peer',
      instanceId: rotated
    }
    expect(resolveProjectPrimaryWorkspace(savedProject, [recreated])).toBeUndefined()
  })

  it('does not rotate identity when the scan is no longer current', async () => {
    const store = makeStore()
    await applyFreshDetectedWorktreeScanSideEffects(store, repo, [], undefined, {
      ownPeerFingerprint: 'test-peer',
      hygieneDue: false,
      isCurrent: () => false
    })

    expect(store.getWorktreeMetaForHost(primary.worktreeId, 'ssh:target-a')?.instanceId).toBe(
      primary.instanceId
    )
  })

  it('rotates a registered folder root only after the owner observes that it is missing', async () => {
    const root = mkdtempSync(join(testState.dir, 'folder-root-'))
    const folderRepo = {
      ...repo,
      id: 'folder-repo',
      path: root,
      kind: 'folder' as const,
      connectionId: undefined
    }
    const folderProject = makeProject({
      id: 'folder-project',
      sourceRepoIds: [folderRepo.id],
      primaryAuthorityFingerprint: 'desktop-authority',
      primaryWorkspaceRevision: 1,
      primaryWorkspace: {
        worktreeId: getRuntimeFolderWorkspaceRootId(folderRepo),
        instanceId: 'folder-instance',
        hostId: 'local',
        path: root,
        peerFingerprint: 'test-peer',
        authorityFingerprint: 'desktop-authority'
      }
    })
    writeDataFile({
      schemaVersion: 1,
      repos: [{ ...folderRepo, executionHostId: 'local' }],
      projects: [folderProject],
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
    store.setWorktreeMetaForHost(folderProject.primaryWorkspace!.worktreeId, 'local', {
      instanceId: 'folder-instance'
    })
    await store.flushPendingOrThrowAsync()
    expect(await inspectFolderRootPresence(folderRepo as never, store)).toBe('present')

    rmSync(root, { recursive: true })
    expect(await inspectFolderRootPresence(folderRepo as never, store)).toBe('missing')
    fenceObservedMissingPrimaryWorktree(store, folderRepo as never, [], 'test-peer')
    await store.flushPendingOrThrowAsync()

    expect(
      store.getWorktreeMetaForHost(folderProject.primaryWorkspace!.worktreeId, 'local')?.instanceId
    ).not.toBe('folder-instance')
    expect(store.getProjects()[0]?.primaryWorkspace).toEqual(folderProject.primaryWorkspace)
  })

  it('requires an authority binding and tolerates malformed saved identity fields', () => {
    const store = makeStore()
    const project = store.getProjects()[0]!
    delete project.primaryAuthorityFingerprint
    fenceObservedMissingPrimaryWorktree(store, repo, [], 'test-peer')
    expect(store.getWorktreeMetaForHost(primary.worktreeId, primary.hostId)?.instanceId).toBe(
      primary.instanceId
    )

    project.primaryAuthorityFingerprint = 'desktop-authority'
    project.primaryWorkspace = {
      ...primary,
      authorityFingerprint: 9
    } as never
    expect(() => fenceObservedMissingPrimaryWorktree(store, repo, [], 'test-peer')).not.toThrow()
    expect(store.getWorktreeMetaForHost(primary.worktreeId, primary.hostId)?.instanceId).toBe(
      primary.instanceId
    )
  })
})
