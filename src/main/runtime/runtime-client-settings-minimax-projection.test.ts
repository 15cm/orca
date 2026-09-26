import { describe, expect, it } from 'vitest'
import { RuntimeClientSettingsController } from './runtime-client-settings'
import { createGlobalSettingsFixture } from '../../shared/global-settings-test-fixture'
import type { GlobalSettings } from '../../shared/global-settings-types'

// Why: the paired client renders the region selector and console link from this projection.
// Omitting a field here silently falls the client back to its own default, and the RPC-level
// tests mock the controller, so only a real get() covers it.
function getProjected(overrides: Partial<GlobalSettings>) {
  const settings = createGlobalSettingsFixture({ workspaceDir: '/w', ...overrides })
  return new RuntimeClientSettingsController({ getSettings: () => settings } as never).get()
}

describe('RuntimeClientSettingsController MiniMax projection', () => {
  it('projects saved launch variants and defaults missing host data to an empty list', () => {
    const variant = { id: 'fast', name: 'Fast', agent: 'claude' as const, command: 'claude --fast' }
    expect(getProjected({ agentLaunchVariants: [variant] }).agentLaunchVariants).toEqual([variant])

    const settings = createGlobalSettingsFixture({ workspaceDir: '/w' })
    delete settings.agentLaunchVariants
    expect(
      new RuntimeClientSettingsController({ getSettings: () => settings } as never).get()
        .agentLaunchVariants
    ).toEqual([])
  })

  it('accepts updates from paired clients and returns the saved variants', async () => {
    const settings = createGlobalSettingsFixture({ workspaceDir: '/w' })
    const controller = new RuntimeClientSettingsController({
      getSettings: () => settings,
      updateSettings: (updates: Partial<GlobalSettings>) => Object.assign(settings, updates)
    } as never)
    const variants = [
      { id: 'fast', name: 'Fast', agent: 'claude' as const, command: 'claude --fast' }
    ]

    const projected = await controller.update({ agentLaunchVariants: variants })

    expect(projected.agentLaunchVariants).toEqual(variants)
    expect(settings.agentLaunchVariants).toEqual(variants)
  })

  it('publishes the China endpoint to paired clients', () => {
    expect(getProjected({ minimaxEndpoint: 'cn' }).minimaxEndpoint).toBe('cn')
  })

  it('publishes the overseas endpoint to paired clients', () => {
    expect(getProjected({ minimaxEndpoint: 'overseas' }).minimaxEndpoint).toBe('overseas')
  })

  it('falls back to overseas when the host has no persisted endpoint', () => {
    const settings = createGlobalSettingsFixture({ workspaceDir: '/w' })
    delete (settings as Partial<GlobalSettings>).minimaxEndpoint
    const projected = new RuntimeClientSettingsController({
      getSettings: () => settings
    } as never).get()
    expect(projected.minimaxEndpoint).toBe('overseas')
  })
})
