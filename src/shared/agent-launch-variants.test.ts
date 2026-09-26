import { describe, expect, it } from 'vitest'
import { normalizeAgentLaunchVariants } from './agent-launch-variants'

describe('normalizeAgentLaunchVariants', () => {
  it('keeps valid variants and removes invalid or duplicate ids and names', () => {
    expect(
      normalizeAgentLaunchVariants([
        { id: 'a', name: ' Fast ', agent: 'claude', command: ' claude --fast ' },
        { id: 'a', name: 'Duplicate id', agent: 'codex', command: 'codex' },
        { id: 'b', name: 'fast', agent: 'codex', command: 'codex' },
        { id: 'c', name: 'No command', agent: 'claude', command: ' ' },
        { id: 'd', name: 'Unknown', agent: 'not-an-agent', command: 'run' }
      ])
    ).toEqual([{ id: 'a', name: 'Fast', agent: 'claude', command: 'claude --fast' }])
  })
})
