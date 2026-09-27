import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  checkRuntimeHooks: vi.fn(),
  getSetupConfig: vi.fn()
}))

vi.mock('@/runtime/runtime-hooks-client', () => ({
  checkRuntimeHooks: mocks.checkRuntimeHooks
}))

vi.mock('@/lib/new-workspace', () => ({
  getSetupConfig: mocks.getSetupConfig
}))

vi.mock('@/lib/github-pr-start-point', () => ({
  resolveGitHubPrStartPointForRepo: vi.fn()
}))

import { resolveDirectSetupDecision } from './launch-work-item-direct-preflight'

describe('resolveDirectSetupDecision', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.checkRuntimeHooks.mockResolvedValue({
      hasHooks: true,
      hooks: { scripts: { setup: 'pnpm install' } },
      mayNeedUpdate: false
    })
    mocks.getSetupConfig.mockReturnValue({ command: 'pnpm install' })
  })

  it('inherits global skip when repository policy is absent', async () => {
    await expect(
      resolveDirectSetupDecision(
        'repo-1',
        {},
        {
          activeRuntimeEnvironmentId: null,
          defaultSetupRunPolicy: 'skip-by-default'
        }
      )
    ).resolves.toEqual({ kind: 'decided', decision: 'skip' })
  })

  it.each([
    ['run-by-default', { kind: 'decided', decision: 'run' }],
    ['ask', { kind: 'needs-modal' }]
  ] as const)(
    'preserves explicit repository %s policy over global skip',
    async (setupRunPolicy, expected) => {
      await expect(
        resolveDirectSetupDecision(
          'repo-1',
          {
            hookSettings: {
              mode: 'auto',
              scripts: { setup: '', archive: '' },
              setupRunPolicy
            }
          },
          {
            activeRuntimeEnvironmentId: null,
            defaultSetupRunPolicy: 'skip-by-default'
          }
        )
      ).resolves.toEqual(expected)
    }
  )

  it('preserves explicit repository skip over global run', async () => {
    await expect(
      resolveDirectSetupDecision(
        'repo-1',
        {
          hookSettings: {
            mode: 'auto',
            scripts: { setup: '', archive: '' },
            setupRunPolicy: 'skip-by-default'
          }
        },
        {
          activeRuntimeEnvironmentId: null,
          defaultSetupRunPolicy: 'run-by-default'
        }
      )
    ).resolves.toEqual({ kind: 'decided', decision: 'skip' })
  })

  it('keeps inherit when no setup command exists', async () => {
    mocks.getSetupConfig.mockReturnValue(null)

    await expect(
      resolveDirectSetupDecision(
        'repo-1',
        {},
        {
          activeRuntimeEnvironmentId: null,
          defaultSetupRunPolicy: 'skip-by-default'
        }
      )
    ).resolves.toEqual({ kind: 'decided', decision: 'inherit' })
  })
})
