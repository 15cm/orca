import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStore, testState, writeDataFile } from '../persistence-test-harness'
import {
  ProjectPrimaryMutationGate,
  type PrimaryRemovalReservation,
  type PrimaryWorkspaceTarget
} from './project-primary-mutation-gate'

const target = (overrides: Partial<PrimaryWorkspaceTarget> = {}): PrimaryWorkspaceTarget => ({
  peerFingerprint: 'peer-a',
  hostId: 'local',
  instanceId: 'instance-a',
  path: '/old',
  ...overrides
})

function harness(initial: PrimaryRemovalReservation[] = []) {
  const saved = [...initial]
  let authority = true
  let selected: PrimaryWorkspaceTarget | undefined
  let confirmCompletion: (reservation: PrimaryRemovalReservation) => Promise<boolean> = async () =>
    true
  const store = {
    load: vi.fn(async () => saved),
    save: vi.fn(async (reservation: PrimaryRemovalReservation) => {
      saved.push(reservation)
    }),
    remove: vi.fn(async (token: string) => {
      const index = saved.findIndex((reservation) => reservation.token === token)
      if (index !== -1) {
        saved.splice(index, 1)
      }
    })
  }
  const gate = new ProjectPrimaryMutationGate({
    store,
    isAuthorityAvailable: () => authority,
    getPrimary: () => selected,
    confirmRemovalCompletion: (reservation) => confirmCompletion(reservation),
    makeToken: () => `token-${saved.length + 1}`
  })
  return {
    gate,
    store,
    saved,
    setAuthority: (value: boolean) => {
      authority = value
    },
    setSelected: (value: PrimaryWorkspaceTarget | undefined) => {
      selected = value
    },
    setConfirmation: (value: (reservation: PrimaryRemovalReservation) => Promise<boolean>) => {
      confirmCompletion = value
    }
  }
}

describe('ProjectPrimaryMutationGate', () => {
  it('serializes competing changes and removal in call order', async () => {
    const { gate } = harness()
    const events: string[] = []
    let started!: () => void
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve
    })
    let release!: () => void
    const first = gate.withPrimaryChange('p', target(), async () => {
      events.push('change-start')
      started()
      await new Promise<void>((resolve) => {
        release = resolve
      })
      events.push('change-end')
    })
    await startedPromise
    const removal = gate.beginRemoval('p', target({ path: '/new' }))
    expect(events).toEqual(['change-start'])
    release()
    await first
    await removal
    expect(events).toEqual(['change-start', 'change-end'])
  })

  it('rejects a change targeting a restored pending removal', async () => {
    const reservation = { token: 'old', projectId: 'p', target: target() }
    const { gate } = harness([reservation])
    await expect(
      gate.withPrimaryChange('p', target({ path: '/different' }), vi.fn())
    ).rejects.toMatchObject({ code: 'primary_removal_pending' })
  })

  it('rejects a later change after removal reserves the same occupant', async () => {
    const { gate } = harness()
    await gate.beginRemoval('p', target({ path: '/before' }))
    await expect(
      gate.withPrimaryChange('p', target({ path: '/after' }), vi.fn())
    ).rejects.toMatchObject({ code: 'primary_removal_pending' })
  })

  it('serializes set then remove and persists the selected-primary fence', async () => {
    const { gate, setSelected } = harness()
    const chosen = target()
    await gate.withPrimaryChange('p', chosen, () => {
      setSelected(chosen)
    })
    await expect(gate.beginRemoval('p', target({ path: '/new' }))).rejects.toMatchObject({
      code: 'primary_selected'
    })
  })

  it('serializes remove then set and never runs a blocked setter', async () => {
    const { gate, setSelected } = harness()
    const chosen = target()
    await gate.beginRemoval('p', chosen)
    const setter = vi.fn(() => {
      setSelected(chosen)
    })
    await expect(
      gate.withPrimaryChange('p', target({ path: '/new' }), setter)
    ).rejects.toMatchObject({ code: 'primary_removal_pending' })
    expect(setter).not.toHaveBeenCalled()
  })

  it('uses owner, host, and instance identity while ignoring path', async () => {
    const { gate } = harness()
    const token = await gate.beginRemoval('p', target({ path: '/first' }))
    expect(await gate.finishRemoval(token, target({ path: '/second' }))).toBe(true)
    const otherPath = await gate.beginRemoval(
      'p',
      target({ path: '/same-path', instanceId: 'other', peerFingerprint: 'peer-b' })
    )
    await expect(
      gate.finishRemoval(
        otherPath,
        target({ instanceId: 'other', peerFingerprint: 'peer-c', path: '/same-path' })
      )
    ).rejects.toMatchObject({ code: 'owner_mismatch' })
  })

  it('blocks removal of the selected primary and cannot be bypassed by force-like callers', async () => {
    const selected = target()
    const { store } = harness()
    const gate = new ProjectPrimaryMutationGate({
      store,
      isAuthorityAvailable: () => true,
      getPrimary: () => selected,
      confirmRemovalCompletion: async () => true
    })
    await expect(
      gate.beginRemoval('p', target({ instanceId: 'other', path: '/elsewhere' }))
    ).resolves.toBeDefined()
    await expect(gate.beginRemoval('p', selected)).rejects.toMatchObject({
      code: 'primary_selected'
    })
  })

  it('does not return a permit when durable save fails', async () => {
    const { gate, store } = harness()
    store.save.mockRejectedValueOnce(new Error('disk full'))
    await expect(gate.beginRemoval('p', target())).rejects.toThrow('disk full')
    await expect(gate.withPrimaryChange('p', target(), vi.fn())).rejects.toMatchObject({
      code: 'primary_removal_pending'
    })
  })

  it('reloads reservations, ignores stale tokens, and denies while authority is unavailable', async () => {
    const reservation = { token: 'persisted', projectId: 'p', target: target() }
    const { gate, setAuthority } = harness([reservation])
    await expect(gate.finishRemoval('unknown', target())).resolves.toBe(false)
    await expect(gate.withPrimaryChange('p', target(), vi.fn())).rejects.toMatchObject({
      code: 'primary_removal_pending'
    })
    setAuthority(false)
    await expect(gate.finishRemoval('persisted', target())).rejects.toMatchObject({
      code: 'authority_unavailable'
    })
  })

  it('keeps the fence when completion proof is false or throws', async () => {
    const { gate, setConfirmation, store } = harness()
    const token = await gate.beginRemoval('p', target())
    setConfirmation(async () => false)
    await expect(gate.finishRemoval(token, target())).resolves.toBe(false)
    expect(store.remove).not.toHaveBeenCalled()
    setConfirmation(async () => {
      throw new Error('still present')
    })
    await expect(gate.finishRemoval(token, target())).rejects.toThrow('still present')
    await expect(gate.withPrimaryChange('p', target(), vi.fn())).rejects.toMatchObject({
      code: 'primary_removal_pending'
    })
  })

  it('retains reservation when durable removal fails and rejects malformed reloads', async () => {
    const { gate, store, saved } = harness()
    const token = await gate.beginRemoval('p', target())
    store.remove.mockRejectedValueOnce(new Error('disk full'))
    await expect(gate.finishRemoval(token, target())).rejects.toThrow('disk full')
    expect(saved.some((reservation) => reservation.token === token)).toBe(true)
    const malformedStore = {
      load: async () => [{ token: '', projectId: 'p', target: target() }],
      save: async () => undefined,
      remove: async () => undefined
    }
    const malformedGate = new ProjectPrimaryMutationGate({
      store: malformedStore,
      isAuthorityAvailable: () => true,
      getPrimary: () => undefined,
      confirmRemovalCompletion: async () => true
    })
    await expect(malformedGate.withPrimaryChange('p', target(), vi.fn())).rejects.toThrow(
      'invalid_primary_removal_reservation'
    )
  })

  it('does not persist or leak a project permit when preflight fails', async () => {
    const { gate, saved, store } = harness()
    await expect(
      gate.beginProjectMutationPermit('p', 'setup:missing', 'peer-a', async () => {
        throw new Error('primary_workspace_wrong_project')
      })
    ).rejects.toThrow('primary_workspace_wrong_project')
    expect(saved).toEqual([])
    expect(store.save).not.toHaveBeenCalled()
    await expect(gate.withPrimaryChange('p', target(), vi.fn())).resolves.toBeUndefined()
  })

  it('restores project permit metadata and fences promotion until its bound peer completes it', async () => {
    const { gate, store } = harness()
    const token = await gate.beginProjectMutationPermit('p', 'setup:setup-a', 'peer-a')
    const reloadedGate = new ProjectPrimaryMutationGate({
      store,
      isAuthorityAvailable: () => true,
      getPrimary: () => undefined,
      confirmRemovalCompletion: async () => true
    })

    await expect(reloadedGate.withPrimaryChange('p', target(), vi.fn())).rejects.toMatchObject({
      code: 'primary_removal_pending'
    })
    await expect(
      reloadedGate.finishProjectMutationPermit(token, {
        projectId: 'p',
        resourceKey: 'setup:setup-a',
        requesterFingerprint: 'peer-b'
      })
    ).resolves.toBe(false)
    await expect(reloadedGate.withPrimaryChange('p', target(), vi.fn())).rejects.toMatchObject({
      code: 'primary_removal_pending'
    })
    await expect(
      reloadedGate.finishProjectMutationPermit(token, {
        projectId: 'p',
        resourceKey: 'setup:setup-a',
        requesterFingerprint: 'peer-a'
      })
    ).resolves.toBe(true)
    await expect(reloadedGate.withPrimaryChange('p', target(), vi.fn())).resolves.toBeUndefined()
  })

  it('keeps a project permit fenced through a real Store flush and reload', async () => {
    testState.dir = mkdtempSync(join(tmpdir(), 'orca-primary-project-permit-'))
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
    try {
      const store = createStore()
      const makeGate = (targetStore: ReturnType<typeof createStore>) =>
        new ProjectPrimaryMutationGate({
          store: {
            load: async () => targetStore.getPrimaryRemovalReservations(),
            save: (reservation) => targetStore.savePrimaryRemovalReservation(reservation),
            remove: (token) => targetStore.removePrimaryRemovalReservation(token)
          },
          isAuthorityAvailable: () => true,
          getPrimary: () => undefined,
          confirmRemovalCompletion: async () => true
        })
      const token = await makeGate(store).beginProjectMutationPermit(
        'project-a',
        'setup:setup-a',
        'peer-a'
      )
      await store.flushPendingOrThrowAsync()
      const reloadedStore = createStore()
      const reloadedGate = makeGate(reloadedStore)
      await expect(reloadedGate.withPrimaryChange('project-a', target(), vi.fn())).rejects.toMatchObject({
        code: 'primary_removal_pending'
      })
      await expect(
        reloadedGate.finishProjectMutationPermit(token, {
          projectId: 'project-a',
          resourceKey: 'setup:setup-a',
          requesterFingerprint: 'peer-a'
        })
      ).resolves.toBe(true)
      expect(reloadedStore.getPrimaryRemovalReservations()).toEqual([])
      await expect(reloadedGate.withPrimaryChange('project-a', target(), vi.fn())).resolves.toBeUndefined()
    } finally {
      rmSync(testState.dir, { recursive: true, force: true })
    }
  })
})
