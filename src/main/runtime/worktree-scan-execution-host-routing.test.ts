// SSH ownership has two spellings on a repo row: the legacy `connectionId` field and the unified
// `executionHostId: 'ssh:*'`. This suite pins the scan and the terminal launch that follows it for
// the second spelling — the seam #17909 identified but could not test end to end (#11163).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const electronMocks = vi.hoisted(() => {
  const ipcMain = {
    on: vi.fn(() => ipcMain),
    removeListener: vi.fn(() => ipcMain),
    emit: vi.fn(() => true)
  }
  return {
    BrowserWindow: { fromId: vi.fn((): unknown => null) },
    webContents: { fromId: vi.fn((): unknown => null) },
    ipcMain,
    app: { getPath: vi.fn(() => '/tmp'), isPackaged: false }
  }
})
vi.mock('electron', () => electronMocks)

const getSshGitProviderMock = vi.hoisted(() => vi.fn())
vi.mock('../providers/ssh-git-dispatch', () => ({
  getSshGitProvider: getSshGitProviderMock,
  getSshGitProviderGeneration: vi.fn(() => 0),
  SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE: 'unavailable',
  requireSshGitProvider: (connectionId: string) => getSshGitProviderMock(connectionId)
}))

const listWorktreesStrictMock = vi.hoisted(() => vi.fn())
vi.mock('../git/worktree', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listWorktreesStrict: listWorktreesStrictMock
}))

vi.mock('./repo-worktree-admin-fingerprint', () => ({
  readRepoWorktreeAdminFingerprint: vi.fn(async () => null)
}))

import { OrcaRuntimeService } from './orca-runtime'
import type { Project, ProjectHostSetup } from '../../shared/project-types'

const TARGET_ID = 'remote-1'
const REPO_ID = 'repo-remote'
const REPO_PATH = '/srv/app'
const WORKTREE_PATH = '/srv/app-feature'
const WORKTREE_ID = `${REPO_ID}::${WORKTREE_PATH}`
const MAIN_WORKTREE_ID = `${REPO_ID}::${REPO_PATH}`

type TestMeta = {
  displayName: string
  comment: string
  linkedIssue: null
  linkedPR: null
  linkedLinearIssue: null
  linkedGitLabMR: null
  linkedGitLabIssue: null
  isArchived: boolean
  isUnread: boolean
  isPinned: boolean
  sortOrder: number
  lastActivityAt: number
  hostId?: string
  instanceId?: string
}

function makeMeta(overrides: Record<string, unknown> = {}): TestMeta {
  return {
    displayName: 'feature',
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
    lastActivityAt: 0,
    ...overrides
  } as TestMeta
}

/** One repo row owned by an SSH host, stamped with `executionHostId` only — no `connectionId`. */
function makeStore(
  repoOverrides: Record<string, unknown>,
  lifecycle: {
    projects?: Project[]
    setups?: ProjectHostSetup[]
    persistPrimary?: (
      projectId: string,
      primary: Project['primaryWorkspace']
    ) => Promise<Project | null>
  } = {}
) {
  const metaById: Record<string, ReturnType<typeof makeMeta>> = {
    [WORKTREE_ID]: makeMeta({
      hostId: `ssh:${TARGET_ID}`,
      instanceId: '11111111-1111-4111-8111-111111111111'
    }),
    [MAIN_WORKTREE_ID]: makeMeta({
      displayName: 'main',
      hostId: `ssh:${TARGET_ID}`,
      instanceId: '22222222-2222-4222-8222-222222222222'
    })
  }
  const repos = [
    {
      id: REPO_ID,
      path: REPO_PATH,
      displayName: 'app',
      badgeColor: 'blue',
      addedAt: 1,
      ...repoOverrides
    }
  ]
  const store = {
    getRepo: (id: string) => repos.find((repo) => repo.id === id),
    getRepos: () => repos,
    getAllWorktreeMeta: () => metaById,
    getWorktreeMeta: (id: string) => metaById[id],
    getWorktreeMetaForHost: (id: string, hostId: string) =>
      metaById[id]?.hostId === hostId ? metaById[id] : undefined,
    setWorktreeMeta: (id: string, meta: Record<string, unknown>) => {
      metaById[id] = { ...(metaById[id] ?? makeMeta()), ...meta } as never
      return metaById[id]
    },
    removeWorktreeMeta: () => {},
    getAllWorktreeLineage: () => ({}),
    getAllWorkspaceLineage: () => ({}),
    removeWorktreeLineage: vi.fn(),
    removeWorkspaceLineage: vi.fn(),
    getGitHubCache: () => undefined as never,
    getSettings: () => ({
      workspaceDir: '/tmp/workspaces',
      nestWorkspaces: false,
      refreshLocalBaseRefOnWorktreeCreate: false,
      branchPrefix: 'none',
      branchPrefixCustom: ''
    }),
    getProjects: () => lifecycle.projects ?? [],
    bindPrimaryAuthorityFingerprintDurably: async (projectId: string, fingerprint: string) => {
      const project = lifecycle.projects?.find((entry) => entry.id === projectId)
      if (
        !project ||
        (project.primaryAuthorityFingerprint && project.primaryAuthorityFingerprint !== fingerprint)
      ) {
        return null
      }
      project.primaryAuthorityFingerprint = fingerprint
      return project
    },
    getProjectHostSetups: () => lifecycle.setups ?? [],
    isPrimaryWorkspaceMutationAvailable: true,
    getPrimaryRemovalReservations: () => [],
    savePrimaryRemovalReservation: async () => {},
    removePrimaryRemovalReservation: async () => {},
    setPrimaryWorkspaceDurably: lifecycle.persistPrimary
  }
  return store
}

type RuntimeInternals = {
  listResolvedWorktrees: () => Promise<{ id: string; path: string; hostId?: string }[]>
}

function makeRuntime(
  repoOverrides: Record<string, unknown>,
  options: {
    projects?: Project[]
    setups?: ProjectHostSetup[]
    persistPrimary?: (
      projectId: string,
      primary: Project['primaryWorkspace']
    ) => Promise<Project | null>
    ownPeerFingerprint?: string | null
    isDesktopAuthority?: boolean
  } = {}
): {
  runtime: OrcaRuntimeService
  list: () => Promise<{ id: string; path: string; hostId?: string }[]>
  store: ReturnType<typeof makeStore>
} {
  const store = makeStore(repoOverrides, options)
  const runtime = new OrcaRuntimeService(store as never, undefined, {
    getOwnPeerFingerprint: () => options.ownPeerFingerprint ?? null,
    isDesktopPrimaryAuthority: () => options.isDesktopAuthority ?? false
  })
  return {
    runtime,
    list: () => (runtime as unknown as RuntimeInternals).listResolvedWorktrees(),
    store
  }
}

describe('worktree scan execution-host routing', () => {
  beforeEach(() => {
    getSshGitProviderMock.mockReset()
    listWorktreesStrictMock.mockReset()
    listWorktreesStrictMock.mockResolvedValue([])
  })

  it('scans an executionHostId-only SSH repo over its SSH provider, not on the client', async () => {
    const listWorktrees = vi.fn(async () => [
      { path: REPO_PATH, head: 'abc', branch: 'main', isBare: false, isMainWorktree: true },
      { path: WORKTREE_PATH, head: 'def', branch: 'feature', isBare: false, isMainWorktree: false }
    ])
    getSshGitProviderMock.mockReturnValue({ listWorktrees })
    const { list } = makeRuntime({ executionHostId: `ssh:${TARGET_ID}` })

    const worktrees = await list()

    expect(getSshGitProviderMock).toHaveBeenCalledWith(TARGET_ID)
    expect(listWorktrees).toHaveBeenCalledWith(REPO_PATH)
    // A client-side `git worktree list` against a remote path is the silent-substitution failure.
    expect(listWorktreesStrictMock).not.toHaveBeenCalled()
    expect(worktrees.map((worktree) => worktree.path).sort()).toEqual([REPO_PATH, WORKTREE_PATH])
    expect(worktrees.every((worktree) => worktree.hostId === `ssh:${TARGET_ID}`)).toBe(true)
  })

  it('publishes authenticated owner identity and seeds a project from the authoritative root row', async () => {
    const listWorktrees = vi.fn(async () => [
      { path: REPO_PATH, head: 'abc', branch: 'main', isBare: false, isMainWorktree: true },
      { path: WORKTREE_PATH, head: 'def', branch: 'feature', isBare: false, isMainWorktree: false }
    ])
    getSshGitProviderMock.mockReturnValue({ listWorktrees })
    const project: Project = {
      id: 'project-a',
      displayName: 'app',
      badgeColor: '#000',
      sourceRepoIds: [REPO_ID],
      createdAt: 1,
      updatedAt: 1
    }
    const persistPrimary = vi.fn(
      async (_projectId: string, primary: Project['primaryWorkspace']) => {
        project.primaryWorkspace = primary
        return project
      }
    )
    const { list } = makeRuntime(
      { executionHostId: `ssh:${TARGET_ID}` },
      {
        projects: [project],
        setups: [
          {
            id: 'setup-a',
            projectId: project.id,
            repoId: REPO_ID,
            hostId: `ssh:${TARGET_ID}`,
            path: REPO_PATH,
            displayName: 'app',
            setupState: 'ready',
            setupMethod: 'cloned',
            createdAt: 1,
            updatedAt: 1
          }
        ],
        persistPrimary,
        ownPeerFingerprint: 'peer-a',
        isDesktopAuthority: true
      }
    )

    const worktrees = await list()

    expect(worktrees.find((worktree) => worktree.path === REPO_PATH)).toMatchObject({
      hostId: `ssh:${TARGET_ID}`,
      ownerHostId: `ssh:${TARGET_ID}`,
      peerFingerprint: 'peer-a'
    })
    await vi.waitFor(() => expect(persistPrimary).toHaveBeenCalledTimes(1))
    expect(project.primaryWorkspace).toMatchObject({
      hostId: `ssh:${TARGET_ID}`,
      worktreeId: MAIN_WORKTREE_ID,
      instanceId: '22222222-2222-4222-8222-222222222222',
      path: REPO_PATH,
      peerFingerprint: 'peer-a',
      authorityFingerprint: 'peer-a'
    })
  })

  it('fences a disappeared SSH owner during runtime scans independently of desktop authority', async () => {
    getSshGitProviderMock.mockReturnValue({
      listWorktrees: async () => [
        { path: REPO_PATH, head: 'abc', branch: 'main', isBare: false, isMainWorktree: true }
      ]
    })
    const project: Project = {
      id: 'project-a',
      displayName: 'app',
      badgeColor: '#000',
      sourceRepoIds: [REPO_ID],
      createdAt: 1,
      updatedAt: 1,
      primaryAuthorityFingerprint: 'desktop-peer',
      primaryWorkspaceRevision: 3,
      primaryWorkspace: {
        worktreeId: WORKTREE_ID,
        instanceId: '11111111-1111-4111-8111-111111111111',
        hostId: `ssh:${TARGET_ID}`,
        path: WORKTREE_PATH,
        peerFingerprint: 'owner-peer',
        authorityFingerprint: 'desktop-peer'
      }
    }
    const { list, store } = makeRuntime(
      { executionHostId: `ssh:${TARGET_ID}` },
      { projects: [project], ownPeerFingerprint: 'owner-peer', isDesktopAuthority: false }
    )

    await list()

    expect(store.getWorktreeMetaForHost(WORKTREE_ID, `ssh:${TARGET_ID}`)?.instanceId).not.toBe(
      project.primaryWorkspace?.instanceId
    )
    expect(project.primaryWorkspace?.instanceId).toBe('11111111-1111-4111-8111-111111111111')
  })

  it('keeps the saved occupant when the SSH catalog is unreachable', async () => {
    getSshGitProviderMock.mockReturnValue({
      listWorktrees: async () => {
        throw new Error('offline')
      }
    })
    const project: Project = {
      id: 'project-a',
      displayName: 'app',
      badgeColor: '#000',
      sourceRepoIds: [REPO_ID],
      createdAt: 1,
      updatedAt: 1,
      primaryAuthorityFingerprint: 'desktop-peer',
      primaryWorkspaceRevision: 3,
      primaryWorkspace: {
        worktreeId: WORKTREE_ID,
        instanceId: '11111111-1111-4111-8111-111111111111',
        hostId: `ssh:${TARGET_ID}`,
        path: WORKTREE_PATH,
        peerFingerprint: 'owner-peer',
        authorityFingerprint: 'desktop-peer'
      }
    }
    const { list, store } = makeRuntime(
      { executionHostId: `ssh:${TARGET_ID}` },
      { projects: [project], ownPeerFingerprint: 'owner-peer', isDesktopAuthority: false }
    )

    await list()

    expect(store.getWorktreeMetaForHost(WORKTREE_ID, `ssh:${TARGET_ID}`)?.instanceId).toBe(
      project.primaryWorkspace?.instanceId
    )
    expect(project.primaryWorkspace?.instanceId).toBe('11111111-1111-4111-8111-111111111111')
  })

  it('fences a folder root after runtime scan observes ENOENT and recreation gets a new instance', async () => {
    const root = mkdtempSync(join(tmpdir(), 'orca-primary-runtime-folder-'))
    const folderId = `${REPO_ID}::${root}`
    const project: Project = {
      id: 'project-a',
      displayName: 'app',
      badgeColor: '#000',
      sourceRepoIds: [REPO_ID],
      createdAt: 1,
      updatedAt: 1,
      primaryAuthorityFingerprint: 'desktop-peer',
      primaryWorkspaceRevision: 3,
      primaryWorkspace: {
        worktreeId: folderId,
        instanceId: 'folder-instance',
        hostId: 'local',
        path: root,
        peerFingerprint: 'folder-owner',
        authorityFingerprint: 'desktop-peer'
      }
    }
    const { list, store } = makeRuntime(
      { path: root, kind: 'folder', executionHostId: 'local' },
      { projects: [project], ownPeerFingerprint: 'folder-owner', isDesktopAuthority: false }
    )
    store.setWorktreeMeta(folderId, {
      hostId: 'local',
      instanceId: 'folder-instance'
    })
    rmSync(root, { recursive: true })

    await list()

    const rotated = store.getWorktreeMetaForHost(folderId, 'local')?.instanceId
    expect(rotated).toBeTruthy()
    expect(rotated).not.toBe('folder-instance')
    expect(project.primaryWorkspace?.instanceId).toBe('folder-instance')
    mkdirSync(root)
    const recreatedRuntime = new OrcaRuntimeService(store as never, undefined, {
      getOwnPeerFingerprint: () => 'folder-owner',
      isDesktopPrimaryAuthority: () => false
    })
    const recreatedRows = await (
      recreatedRuntime as unknown as RuntimeInternals
    ).listResolvedWorktrees()
    expect(recreatedRows.find((row) => row.id === folderId)).toMatchObject({ instanceId: rotated })
    rmSync(root, { recursive: true })
  })

  it('routes the PTY of an executionHostId-only SSH worktree to its host', async () => {
    getSshGitProviderMock.mockReturnValue({
      listWorktrees: async () => [
        { path: REPO_PATH, head: 'abc', branch: 'main', isBare: false, isMainWorktree: true },
        {
          path: WORKTREE_PATH,
          head: 'def',
          branch: 'feature',
          isBare: false,
          isMainWorktree: false
        }
      ]
    })
    const { runtime } = makeRuntime({ executionHostId: `ssh:${TARGET_ID}` })
    const spawn = vi.fn().mockResolvedValue({ id: 'pty-1' })
    runtime.setPtyController({
      spawn,
      write: () => true,
      kill: () => true,
      getForegroundProcess: async () => null
    } as never)

    await runtime.createTerminal(`id:${WORKTREE_ID}`)

    expect(spawn).toHaveBeenCalledWith(
      expect.objectContaining({ connectionId: TARGET_ID, cwd: WORKTREE_PATH })
    )
  })

  it('still routes a legacy connectionId-only SSH repo the same way', async () => {
    getSshGitProviderMock.mockReturnValue({
      listWorktrees: async () => [
        { path: REPO_PATH, head: 'abc', branch: 'main', isBare: false, isMainWorktree: true },
        {
          path: WORKTREE_PATH,
          head: 'def',
          branch: 'feature',
          isBare: false,
          isMainWorktree: false
        }
      ]
    })
    const { runtime } = makeRuntime({ connectionId: TARGET_ID })
    const spawn = vi.fn().mockResolvedValue({ id: 'pty-1' })
    runtime.setPtyController({
      spawn,
      write: () => true,
      kill: () => true,
      getForegroundProcess: async () => null
    } as never)

    await runtime.createTerminal(`id:${WORKTREE_ID}`)

    expect(getSshGitProviderMock).toHaveBeenCalledWith(TARGET_ID)
    expect(spawn).toHaveBeenCalledWith(
      expect.objectContaining({ connectionId: TARGET_ID, cwd: WORKTREE_PATH })
    )
  })
})
