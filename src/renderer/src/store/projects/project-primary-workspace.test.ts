import { describe, expect, it, vi } from 'vitest'
import { createTestStore } from '../slices/store-test-helpers'
import type { Project } from '../../../../shared/project-types'

const project: Project = {
  id: 'p',
  displayName: 'Project',
  badgeColor: '#000',
  sourceRepoIds: ['r'],
  createdAt: 1,
  updatedAt: 1,
  primaryWorkspaceRevision: 5,
  primaryAuthorityFingerprint: 'authority',
  primaryWorkspace: {
    worktreeId: 'r::/old',
    instanceId: 'old',
    hostId: 'local',
    path: '/old',
    peerFingerprint: 'peer',
    authorityFingerprint: 'authority'
  }
}

describe('setProjectPrimaryWorkspace', () => {
  it('uses local authority, merges returned project, and leaves workspace session untouched', async () => {
    const resultProject = {
      ...project,
      primaryWorkspaceRevision: 6,
      primaryWorkspace: {
        worktreeId: 'r::/feature',
        instanceId: 'feature-1',
        hostId: 'local' as const,
        path: '/feature',
        peerFingerprint: 'peer',
        authorityFingerprint: 'authority'
      }
    }
    const runtimeCall = vi.fn().mockResolvedValue({ ok: true, result: { project: resultProject } })
    vi.stubGlobal('window', { api: { runtime: { call: runtimeCall } } })
    const store = createTestStore()
    const sessionBefore = { ...store.getState().tabsByWorktree }
    store.setState({ projects: [project], activeWorktreeId: 'r::/active', activeTabId: 'tab' })

    const result = await store.getState().setProjectPrimaryWorkspace('p', 'r::/feature', 'local')

    expect(runtimeCall).toHaveBeenCalledWith({
      method: 'project.primary.set',
      params: {
        projectId: 'p',
        worktree: 'r::/feature',
        hostId: 'local'
      }
    })
    expect(result).toEqual({ project: resultProject })
    expect(store.getState().projects[0]?.primaryWorkspace).toEqual(resultProject.primaryWorkspace)
    expect(store.getState().activeWorktreeId).toBe('r::/active')
    expect(store.getState().activeTabId).toBe('tab')
    expect(store.getState().tabsByWorktree).toEqual(sessionBefore)
  })

  it('returns RPC errors without mutating projects', async () => {
    const runtimeCall = vi.fn().mockRejectedValue(new Error('offline'))
    vi.stubGlobal('window', { api: { runtime: { call: runtimeCall } } })
    const store = createTestStore()
    store.setState({ projects: [project] })
    const result = await store.getState().setProjectPrimaryWorkspace('p', 'r::/feature')
    expect('error' in result).toBe(true)
    expect(store.getState().projects[0]).toEqual(project)
  })

  it('does not replace a newer authoritative project already in state', async () => {
    const runtimeCall = vi.fn().mockResolvedValue({
      ok: true,
      result: { project: { ...project, primaryWorkspaceRevision: 4 } }
    })
    vi.stubGlobal('window', { api: { runtime: { call: runtimeCall } } })
    const store = createTestStore()
    const newer = { ...project, primaryWorkspaceRevision: 8 }
    store.setState({ projects: [newer] })
    await store.getState().setProjectPrimaryWorkspace('p', 'r::/feature')
    expect(store.getState().projects[0]?.primaryWorkspaceRevision).toBe(8)
  })

  it('rejects malformed project responses without changing store state', async () => {
    const runtimeCall = vi.fn().mockResolvedValue({ ok: true, result: { project: { id: 'p' } } })
    vi.stubGlobal('window', { api: { runtime: { call: runtimeCall } } })
    const store = createTestStore()
    store.setState({ projects: [project] })
    const result = await store.getState().setProjectPrimaryWorkspace('p', 'r::/feature')
    expect('error' in result).toBe(true)
    expect(store.getState().projects[0]).toEqual(project)
  })

  it('rejects response selection authority that conflicts with response project binding', async () => {
    const runtimeCall = vi.fn().mockResolvedValue({
      ok: true,
      result: {
        project: {
          ...project,
          primaryAuthorityFingerprint: 'other-authority'
        }
      }
    })
    vi.stubGlobal('window', { api: { runtime: { call: runtimeCall } } })
    const store = createTestStore()
    store.setState({ projects: [project] })

    const result = await store.getState().setProjectPrimaryWorkspace('p', 'r::/feature')

    expect('error' in result).toBe(true)
    expect(store.getState().projects[0]).toEqual(project)
  })

  it('rejects authority conflicts from a current project binding without a saved choice', async () => {
    const runtimeCall = vi.fn().mockResolvedValue({
      ok: true,
      result: { project: { ...project, primaryWorkspaceRevision: 6 } }
    })
    vi.stubGlobal('window', { api: { runtime: { call: runtimeCall } } })
    const store = createTestStore()
    const boundWithoutChoice = {
      ...project,
      primaryWorkspace: null as never,
      primaryAuthorityFingerprint: 'other-authority'
    }
    store.setState({ projects: [boundWithoutChoice] })

    const result = await store.getState().setProjectPrimaryWorkspace('p', 'r::/feature')

    expect('error' in result).toBe(true)
    expect(store.getState().projects[0]).toEqual(boundWithoutChoice)
  })

  it('merges cross-host repo ownership from authoritative project', async () => {
    const runtimeCall = vi.fn().mockResolvedValue({
      ok: true,
      result: {
        project: {
          ...project,
          sourceRepoIds: ['remote'],
          primaryWorkspace: {
            ...project.primaryWorkspace!,
            worktreeId: 'remote::/x',
            instanceId: 'x'
          },
          primaryWorkspaceRevision: 6
        }
      }
    })
    vi.stubGlobal('window', { api: { runtime: { call: runtimeCall } } })
    const store = createTestStore()
    store.setState({ projects: [project] })
    await store.getState().setProjectPrimaryWorkspace('p', 'remote::/x')
    expect(store.getState().projects[0]?.sourceRepoIds).toEqual(['r', 'remote'])
  })

  it.each([
    [
      'missing authority',
      { primaryWorkspace: { ...project.primaryWorkspace!, authorityFingerprint: '' } }
    ],
    ['empty path', { primaryWorkspace: { ...project.primaryWorkspace!, path: '  ' } }],
    ['invalid revision', { primaryWorkspaceRevision: Number.MAX_SAFE_INTEGER + 1 }],
    ['invalid host', { primaryWorkspace: { ...project.primaryWorkspace!, hostId: 'bad-host' } }],
    [
      'unsupported runtime owner host',
      { primaryWorkspace: { ...project.primaryWorkspace!, hostId: 'runtime:env-a' } }
    ]
  ])('rejects %s response', async (_label, override) => {
    const runtimeCall = vi
      .fn()
      .mockResolvedValue({ ok: true, result: { project: { ...project, ...override } } })
    vi.stubGlobal('window', { api: { runtime: { call: runtimeCall } } })
    const store = createTestStore()
    store.setState({ projects: [project] })
    expect('error' in (await store.getState().setProjectPrimaryWorkspace('p', 'r::/x'))).toBe(true)
    expect(store.getState().projects[0]).toEqual(project)
  })

  it('rejects authority changes and equal revision reassignment', async () => {
    for (const replacement of [
      { ...project.primaryWorkspace!, authorityFingerprint: 'other' },
      { ...project.primaryWorkspace!, worktreeId: 'r::/other' },
      { ...project.primaryWorkspace!, path: '/different-locator' }
    ]) {
      const runtimeCall = vi.fn().mockResolvedValue({
        ok: true,
        result: { project: { ...project, primaryWorkspace: replacement } }
      })
      vi.stubGlobal('window', { api: { runtime: { call: runtimeCall } } })
      const store = createTestStore()
      store.setState({ projects: [project] })
      await store.getState().setProjectPrimaryWorkspace('p', 'r::/x')
      expect(store.getState().projects[0]?.primaryWorkspace).toEqual(project.primaryWorkspace)
    }
  })
})
