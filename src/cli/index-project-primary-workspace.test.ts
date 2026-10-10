import { describe, expect, it, vi } from 'vitest'

const {
  callMock,
  runtimeClientConstructorMock,
  serveOrcaAppMock,
  getDefaultUserDataPathMock,
  addEnvironmentFromPairingCodeMock,
  listEnvironmentsMock,
  spawnMock
} = vi.hoisted(() => ({
  callMock: vi.fn(),
  runtimeClientConstructorMock: vi.fn(),
  serveOrcaAppMock: vi.fn(),
  getDefaultUserDataPathMock: vi.fn(() => '/tmp/orca-user-data'),
  addEnvironmentFromPairingCodeMock: vi.fn(),
  listEnvironmentsMock: vi.fn(),
  spawnMock: vi.fn()
}))

vi.mock('./runtime-client', async () => {
  const { createRuntimeClientModuleMock } = await import('./index-test-harness.js')
  return createRuntimeClientModuleMock({
    callMock,
    runtimeClientConstructorMock,
    serveOrcaAppMock,
    getDefaultUserDataPathMock
  })
})
vi.mock('./runtime/environments', () => ({
  addEnvironmentFromPairingCode: addEnvironmentFromPairingCodeMock,
  listEnvironments: listEnvironmentsMock,
  removeEnvironment: vi.fn(),
  resolveEnvironment: vi.fn()
}))
vi.mock('child_process', async () => {
  const { createChildProcessModuleMock } = await import('./index-test-harness.js')
  return createChildProcessModuleMock(spawnMock)
})

import { main } from './index'
import { okFixture, queueFixtures, worktreeListFixture, buildWorktree } from './test-fixtures'
import { pairRuntimeEnvironment, useWorktreeAwarenessEnvironment } from './index-test-harness'

describe('orca project primary workspace CLI', () => {
  useWorktreeAwarenessEnvironment({
    callMock,
    serveOrcaAppMock,
    getDefaultUserDataPathMock,
    addEnvironmentFromPairingCodeMock,
    listEnvironmentsMock,
    spawnMock
  })

  it('lists primary selection and revision in project JSON', async () => {
    queueFixtures(
      callMock,
      okFixture('req_project_list', {
        projects: [
          {
            id: 'p',
            displayName: 'Project',
            badgeColor: '#111',
            sourceRepoIds: ['r'],
            createdAt: 1,
            updatedAt: 2,
            primaryWorkspace: {
              worktreeId: 'r::/feature',
              instanceId: 'i',
              hostId: 'local',
              path: '/feature',
              peerFingerprint: 'peer',
              authorityFingerprint: 'auth'
            },
            primaryWorkspaceRevision: 7
          }
        ]
      })
    )
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await main(['project', 'list', '--json'], '/tmp/repo')
    expect(logSpy.mock.calls.flat().join('\n')).toContain('primaryWorkspaceRevision')
    expect(logSpy.mock.calls.flat().join('\n')).toContain('authorityFingerprint')
  })

  it('sends exact worktree selector and canonical explicit host', async () => {
    pairRuntimeEnvironment(listEnvironmentsMock, 'runtime-id', 'builder')
    queueFixtures(
      callMock,
      okFixture('req_project_primary_set', { project: { id: 'p' }, revision: 8 })
    )
    vi.spyOn(console, 'log').mockImplementation(() => {})
    await main(
      [
        'project',
        'set-primary',
        '--project',
        'p',
        '--worktree',
        'r::/feature',
        '--host',
        'runtime:runtime-id',
        '--json'
      ],
      '/tmp/repo'
    )
    expect(runtimeClientConstructorMock).toHaveBeenCalledWith(null, 'runtime-id')
    expect(callMock).toHaveBeenCalledWith('project.primary.set', {
      projectId: 'p',
      worktree: 'r::/feature',
      hostId: 'runtime:runtime-id'
    })
  })

  it('omits host when caller relies on current runtime context', async () => {
    queueFixtures(
      callMock,
      okFixture('req_project_primary_set', { project: { id: 'p' }, revision: 1 })
    )
    vi.spyOn(console, 'log').mockImplementation(() => {})
    await main(
      ['project', 'set-primary', '--project', 'p', '--worktree', 'id:r::/feature', '--json'],
      '/tmp/repo'
    )
    expect(callMock).toHaveBeenCalledWith('project.primary.set', {
      projectId: 'p',
      worktree: 'id:r::/feature'
    })
  })

  it('resolves the shared current selector to the exact workspace before setting primary', async () => {
    queueFixtures(
      callMock,
      worktreeListFixture([buildWorktree('/repo/feature', 'feature', 'head-a', 'r')]),
      okFixture('req_project_primary_set', {
        project: { id: 'p' },
        primaryWorkspace: {
          worktreeId: 'r::/repo/feature',
          instanceId: 'instance-a',
          hostId: 'local',
          path: '/repo/feature',
          peerFingerprint: 'peer-a',
          authorityFingerprint: 'authority-a'
        },
        revision: 12
      })
    )
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await main(
      ['project', 'set-primary', '--project', 'p', '--worktree', 'current', '--json'],
      '/repo/feature/nested'
    )

    expect(callMock).toHaveBeenNthCalledWith(1, 'worktree.list', { limit: 10_000 })
    expect(callMock).toHaveBeenNthCalledWith(2, 'project.primary.set', {
      projectId: 'p',
      worktree: 'id:r::/repo/feature'
    })
    const output = JSON.parse(String(logSpy.mock.calls.at(-1)?.[0])) as {
      result: {
        project: { id: string }
        primaryWorkspace: { authorityFingerprint: string }
        revision: number
      }
    }
    expect(output.result.project.id).toBe('p')
    expect(output.result.primaryWorkspace.authorityFingerprint).toBe('authority-a')
    expect(output.result.revision).toBe(12)
  })

  it('treats ambient runtime context as remote for cwd-based current selectors', async () => {
    vi.stubEnv('ORCA_ENVIRONMENT', 'runtime-context')
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const priorExitCode = process.exitCode

    await main(
      ['project', 'set-primary', '--project', 'p', '--worktree', 'current', '--json'],
      '/tmp/repo'
    )

    expect([...logSpy.mock.calls, ...errSpy.mock.calls].flat().join('\n')).toContain(
      'cannot be resolved against a remote runtime'
    )
    expect(callMock).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
    process.exitCode = priorExitCode
  })

  it('gives friendly upgrade guidance for older runtime without fallback', async () => {
    const { RuntimeClientError } = await import('./runtime/types.js')
    callMock.mockRejectedValueOnce(
      new RuntimeClientError('method_not_found', 'Unknown method: project.primary.set')
    )
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const priorExitCode = process.exitCode
    await main(
      ['project', 'set-primary', '--project', 'p', '--worktree', 'r::/feature', '--json'],
      '/tmp/repo'
    )
    const output = [...logSpy.mock.calls, ...errSpy.mock.calls].flat().join('\n')
    expect(output).toContain('does not support primary workspaces yet')
    expect(output).not.toContain('Unknown method')
    expect(callMock).toHaveBeenCalledTimes(1)
    expect(process.exitCode).toBe(1)
    process.exitCode = priorExitCode
  })

  it('propagates cross-project and ambiguous-selector server errors', async () => {
    const { RuntimeClientError } = await import('./runtime/types.js')
    let expectedCallCount = 0
    for (const error of [
      new RuntimeClientError('invalid_argument', 'Workspace belongs to another project'),
      new RuntimeClientError('invalid_argument', 'Worktree selector is ambiguous')
    ]) {
      callMock.mockRejectedValueOnce(error)
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const priorExitCode = process.exitCode
      await main(
        ['project', 'set-primary', '--project', 'p', '--worktree', 'same/path', '--json'],
        '/tmp/repo'
      )
      expect([...logSpy.mock.calls, ...errSpy.mock.calls].flat().join('\n')).toContain(
        error.message
      )
      expectedCallCount += 1
      expect(callMock).toHaveBeenCalledTimes(expectedCallCount)
      expect(callMock).toHaveBeenLastCalledWith('project.primary.set', {
        projectId: 'p',
        worktree: 'same/path'
      })
      expect(process.exitCode).toBe(1)
      process.exitCode = priorExitCode
    }
  })
})
