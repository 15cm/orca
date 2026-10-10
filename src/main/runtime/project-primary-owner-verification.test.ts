import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inspectFolderRootPresence, verifyPrimaryOwner } from './project-primary-owner-verification'

const { resolveFilesystemRouteMock, getLocalProjectWorktreeGitOptionsMock } = vi.hoisted(() => ({
  resolveFilesystemRouteMock: vi.fn(),
  getLocalProjectWorktreeGitOptionsMock: vi.fn(() => ({}))
}))
vi.mock('../providers/execution-host-provider-dispatch', () => ({
  resolveFilesystemRouteForHost: resolveFilesystemRouteMock
}))
vi.mock('../project-runtime-git-options', () => ({
  getLocalProjectWorktreeGitOptions: getLocalProjectWorktreeGitOptionsMock
}))

const base = (path: string, hostId = 'local') =>
  ({
    id: 'folder',
    repoId: 'folder',
    hostId,
    path,
    instanceId: 'occupant',
    isArchived: false,
    isBare: false,
    prunable: false
  }) as never

function deps(repoPath: string, hostId = 'local', instanceId = 'occupant') {
  return {
    listRepos: () =>
      [
        {
          id: 'folder',
          path: repoPath,
          kind: 'folder',
          ...(hostId.startsWith('ssh:')
            ? { connectionId: hostId.slice('ssh:'.length) }
            : { executionHostId: 'local' })
        }
      ] as never,
    store: { getWorktreeMetaForHost: () => ({ instanceId }) } as never
  }
}

describe('verifyPrimaryOwner folder proof', () => {
  it('requires an existing directory at the registered root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-primary-'))
    resolveFilesystemRouteMock.mockReturnValue({ kind: 'local' })
    await expect(verifyPrimaryOwner(base(root), deps(root))).resolves.toBe(true)
    await rm(root, { recursive: true })
    await expect(verifyPrimaryOwner(base(root), deps(root))).resolves.toBe(false)
  })

  it('rejects a registered folder root replaced by a file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'orca-primary-'))
    const file = join(directory, 'replaced-root')
    await writeFile(file, 'not a directory')
    resolveFilesystemRouteMock.mockReturnValue({ kind: 'local' })
    await expect(verifyPrimaryOwner(base(file), deps(file))).resolves.toBe(false)
    await expect(
      inspectFolderRootPresence(
        { id: 'folder', path: file, kind: 'folder', executionHostId: 'local' } as never,
        deps(file).store
      )
    ).resolves.toBe('missing')
    await rm(directory, { recursive: true })
  })

  it('keeps a disconnected folder owner unverifiable', async () => {
    resolveFilesystemRouteMock.mockReturnValue({ kind: 'ssh', provider: null })
    await expect(
      inspectFolderRootPresence(
        {
          id: 'folder',
          path: '/remote/root',
          kind: 'folder',
          connectionId: 'target-a'
        } as never,
        deps('/remote/root', 'ssh:target-a').store
      )
    ).resolves.toBe('unverifiable')
  })

  it('rejects child paths and runtime owners', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-primary-'))
    const child = join(root, 'child')
    await mkdir(child)
    await expect(verifyPrimaryOwner(base(child), deps(root))).resolves.toBe(false)
    await expect(verifyPrimaryOwner(base(root, 'runtime:env'), deps(root))).resolves.toBe(false)
    await rm(root, { recursive: true })
  })

  it('does not call a local stat seam when SSH owner is disconnected', async () => {
    resolveFilesystemRouteMock.mockReturnValue({ kind: 'ssh', provider: undefined })
    const statOwnerPath = vi.fn(async () => true)
    const folder = {
      id: 'folder',
      path: '/remote/root',
      kind: 'folder',
      connectionId: 'target-a'
    }
    await expect(
      verifyPrimaryOwner(base('/remote/root', 'ssh:target-a'), {
        ...deps('/remote/root', 'ssh:target-a'),
        listRepos: () => [folder] as never,
        statOwnerPath
      })
    ).resolves.toBe(false)
    expect(statOwnerPath).not.toHaveBeenCalled()
  })

  it('uses SSH stat result and rejects errors and non-directories', async () => {
    const provider = { stat: vi.fn().mockResolvedValue({ type: 'directory' }) }
    resolveFilesystemRouteMock.mockReturnValue({ kind: 'ssh', provider })
    await expect(
      verifyPrimaryOwner(base('/remote/root', 'ssh:target-a'), deps('/remote/root', 'ssh:target-a'))
    ).resolves.toBe(true)
    provider.stat.mockResolvedValue({ type: 'file' })
    await expect(
      verifyPrimaryOwner(base('/remote/root', 'ssh:target-a'), deps('/remote/root', 'ssh:target-a'))
    ).resolves.toBe(false)
    provider.stat.mockRejectedValue(new Error('disconnected'))
    await expect(
      verifyPrimaryOwner(base('/remote/root', 'ssh:target-a'), deps('/remote/root', 'ssh:target-a'))
    ).resolves.toBe(false)
  })

  it('rejects a replaced instance at the same path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-primary-'))
    resolveFilesystemRouteMock.mockReturnValue({ kind: 'local' })
    const statOwnerPath = vi.fn(async () => true)
    await expect(
      verifyPrimaryOwner(base(root), {
        ...deps(root, 'local', 'replacement-instance'),
        statOwnerPath
      })
    ).resolves.toBe(false)
    expect(statOwnerPath).not.toHaveBeenCalled()
    await rm(root, { recursive: true })
  })
})
