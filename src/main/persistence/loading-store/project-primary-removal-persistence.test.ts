import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setAppEnvironment } from '../../../shared/app-environment'
import type { PrimaryRemovalReservation } from '../../../shared/project-primary-removal'

vi.mock('electron', () => ({
  app: {
    getPath: () => tmpdir(),
    getName: () => 'orca-test',
    getVersion: () => '0.0.0-test',
    isPackaged: false,
    on: () => {},
    whenReady: () => Promise.resolve()
  },
  safeStorage: { isEncryptionAvailable: () => false },
  ipcMain: { on: () => {}, handle: () => {} },
  BrowserWindow: { getAllWindows: () => [] }
}))

const { Store } = await import('./store')
setAppEnvironment({
  getPath: () => tmpdir(),
  getAppPath: () => tmpdir(),
  getVersion: () => '0.0.0-test',
  isPackaged: () => false,
  onWillQuit: () => {},
  exit: () => {},
  getAppMetrics: () => []
})
const stores: InstanceType<typeof Store>[] = []
afterEach(() => {
  for (const store of stores.splice(0)) {
    store.flush()
  }
  vi.restoreAllMocks()
})

function openStore(dataFile: string): InstanceType<typeof Store> {
  const store = new Store({ dataFile })
  stores.push(store)
  return store
}

const reservation: PrimaryRemovalReservation = {
  token: 'removal-token',
  projectId: 'project-1',
  target: {
    peerFingerprint: 'peer-1',
    hostId: 'local',
    instanceId: 'occupant-1',
    path: '/worktree'
  }
}

describe('primary removal reservation persistence', () => {
  it('reloads durable reservations and removes them durably', async () => {
    const dataFile = join(mkdtempSync(join(tmpdir(), 'orca-primary-removal-')), 'state.json')
    const first = openStore(dataFile)
    await first.savePrimaryRemovalReservation(reservation)
    const reloaded = openStore(dataFile)
    expect(reloaded.getPrimaryRemovalReservations()).toEqual([reservation])
    await reloaded.removePrimaryRemovalReservation(reservation.token)
    const final = openStore(dataFile)
    expect(final.getPrimaryRemovalReservations()).toEqual([])
  })

  it('restores the in-memory fence when durable removal fails', async () => {
    const store = openStore(
      join(mkdtempSync(join(tmpdir(), 'orca-primary-removal-fail-')), 'state.json')
    )
    await store.savePrimaryRemovalReservation(reservation)
    vi.spyOn(store, 'flushPendingOrThrowAsync').mockRejectedValueOnce(new Error('disk unavailable'))
    await expect(store.removePrimaryRemovalReservation(reservation.token)).rejects.toThrow(
      'disk unavailable'
    )
    expect(store.getPrimaryRemovalReservations()).toEqual([reservation])
  })

  it('rolls back exact primary selection and revision when the durable write fails', async () => {
    const dataFile = join(mkdtempSync(join(tmpdir(), 'orca-primary-write-fail-')), 'state.json')
    const store = openStore(dataFile)
    store.addRepo({
      id: 'repo-1',
      path: '/repo-1',
      displayName: 'repo',
      badgeColor: '#000',
      addedAt: 1
    } as never)
    await store.flushPendingOrThrowAsync()
    const projectId = store.getProjects()[0].id
    await store.bindPrimaryAuthorityFingerprintDurably(projectId, 'peer-a')
    vi.spyOn(store, 'flushPendingOrThrowAsync').mockRejectedValueOnce(new Error('disk unavailable'))

    await expect(
      store.setPrimaryWorkspaceDurably(projectId, {
        worktreeId: 'repo-1::/worktree',
        path: '/worktree',
        hostId: 'local',
        instanceId: 'instance-a',
        peerFingerprint: 'peer-a',
        authorityFingerprint: 'peer-a'
      })
    ).rejects.toThrow('disk unavailable')
    const rolledBack = store.getProjects().find((entry) => entry.id === projectId)!
    expect(rolledBack.primaryWorkspace).toBeUndefined()
    expect(rolledBack.primaryWorkspaceRevision).toBeUndefined()
    const reloaded = openStore(dataFile)
      .getProjects()
      .find((entry) => entry.id === projectId)!
    expect(reloaded.primaryWorkspace).toBeUndefined()
    expect(reloaded.primaryWorkspaceRevision).toBeUndefined()
  })

  it('disables further primary mutations when rollback cannot be durably confirmed', async () => {
    const dataFile = join(mkdtempSync(join(tmpdir(), 'orca-primary-rollback-fail-')), 'state.json')
    const store = openStore(dataFile)
    store.addRepo({
      id: 'repo-1',
      path: '/repo-1',
      displayName: 'repo',
      badgeColor: '#000',
      addedAt: 1
    } as never)
    await store.flushPendingOrThrowAsync()
    const projectId = store.getProjects()[0].id
    await store.bindPrimaryAuthorityFingerprintDurably(projectId, 'peer-a')
    vi.spyOn(store, 'flushPendingOrThrowAsync')
      .mockRejectedValueOnce(new Error('write failed'))
      .mockRejectedValueOnce(new Error('rollback failed'))

    await expect(
      store.setPrimaryWorkspaceDurably(projectId, {
        worktreeId: 'repo-1::/worktree',
        path: '/worktree',
        hostId: 'local',
        instanceId: 'instance-a',
        peerFingerprint: 'peer-a',
        authorityFingerprint: 'peer-a'
      })
    ).rejects.toThrow('primary_workspace_persistence_failed_closed')
    expect(store.isPrimaryWorkspaceMutationAvailable).toBe(false)
    await expect(store.setPrimaryWorkspaceDurably(projectId, undefined)).rejects.toThrow(
      'primary_workspace_persistence_unavailable'
    )
    const project = store.getProjects().find((entry) => entry.id === projectId)!
    expect(project.primaryWorkspace).toBeUndefined()
    expect(project.primaryWorkspaceRevision).toBeUndefined()
  })
})
