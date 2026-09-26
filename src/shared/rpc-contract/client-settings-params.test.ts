import { describe, expect, it } from 'vitest'
import { SettingsUpdate } from './client-settings-params'

describe('SettingsUpdate agent launch variants', () => {
  it('accepts older clients that omit variants and normalizes new client values', () => {
    expect(SettingsUpdate.parse({ agentDefaultArgs: {} })).toEqual({ agentDefaultArgs: {} })
    expect(
      SettingsUpdate.parse({
        agentLaunchVariants: [
          { id: 'fast', name: ' Fast ', agent: 'claude', command: ' claude --fast ' },
          { id: 'bad', name: '', agent: 'claude', command: 'claude' }
        ]
      }).agentLaunchVariants
    ).toEqual([{ id: 'fast', name: 'Fast', agent: 'claude', command: 'claude --fast' }])
  })
})
