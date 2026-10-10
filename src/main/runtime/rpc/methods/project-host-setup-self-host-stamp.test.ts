import { describe, expect, it } from 'vitest'
import { PROJECT_RUNTIME_METHODS } from './project-runtime-rpc-methods'

// Why: a paired client addresses this runtime as `runtime:<its own env id>`. Persisting that
// verbatim hides the row from every other client and defeats the (projectId, hostId) duplicate
// check, so the request's host id has to be re-spelled as this machine's own `local`.
function parseParams(methodName: string, params: unknown): { hostId: string } {
  const method = PROJECT_RUNTIME_METHODS.find((candidate) => candidate.name === methodName)
  if (!method?.params) {
    throw new Error(`Missing params schema for ${methodName}`)
  }
  const parsed = method.params.parse(params)
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !('hostId' in parsed) ||
    typeof parsed.hostId !== 'string'
  ) {
    throw new Error(`Missing hostId in ${methodName} params`)
  }
  return { hostId: parsed.hostId }
}

const CREATING_METHODS = [
  {
    name: 'projectHostSetup.setupExistingFolder',
    base: { projectId: 'github:stablyai/orca', path: '/srv/orca' }
  },
  {
    name: 'projectHostSetup.clone',
    base: {
      projectId: 'github:stablyai/orca',
      url: 'https://github.com/stablyai/orca.git',
      destination: '/srv'
    }
  },
  { name: 'projectHostSetup.create', base: { projectId: 'github:stablyai/orca' } }
] as const

describe('project host setup self-host stamp', () => {
  it('waits for projectHostSetup.delete to finish before replying', async () => {
    let finishDelete!: (value: { project: null; setup: null; repo: null }) => void
    const deletion = new Promise<{ project: null; setup: null; repo: null }>((resolve) => {
      finishDelete = resolve
    })
    const runtime = { deleteProjectHostSetup: () => deletion }
    const method = PROJECT_RUNTIME_METHODS.find(
      (candidate) => candidate.name === 'projectHostSetup.delete'
    )!
    let settled = false
    const response = method.handler({ setupId: 'setup-a' }, { runtime } as never).then((value) => {
      settled = true
      return value
    })

    await Promise.resolve()
    expect(settled).toBe(false)
    finishDelete({ project: null, setup: null, repo: null })
    await expect(response).resolves.toEqual({ result: { project: null, setup: null, repo: null } })
  })

  it.each(CREATING_METHODS)('$name stores a caller runtime id as local', ({ name, base }) => {
    const parsed = parseParams(name, { ...base, hostId: 'runtime:c0ffee-env-id' })

    expect(parsed.hostId).toBe('local')
  })

  it.each(CREATING_METHODS)('$name leaves an explicit local host alone', ({ name, base }) => {
    expect(parseParams(name, { ...base, hostId: 'local' }).hostId).toBe('local')
  })

  // Why: ssh targets are a different machine from the runtime handling the call, so they must
  // keep their own identity — only `runtime:` means "you".
  it.each(CREATING_METHODS)('$name preserves an ssh host', ({ name, base }) => {
    expect(parseParams(name, { ...base, hostId: 'ssh:box-1' }).hostId).toBe('ssh:box-1')
  })

  it.each(CREATING_METHODS)('$name still rejects an unparseable host', ({ name, base }) => {
    expect(() => parseParams(name, { ...base, hostId: 'nonsense' })).toThrow()
    expect(() => parseParams(name, { ...base, hostId: 'runtime:' })).toThrow()
  })

  // Two clients paired with the same server now converge on one row instead of one each.
  it('collapses two different clients onto the same host id', () => {
    const fromClientA = parseParams('projectHostSetup.create', {
      projectId: 'github:stablyai/orca',
      hostId: 'runtime:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    })
    const fromClientB = parseParams('projectHostSetup.create', {
      projectId: 'github:stablyai/orca',
      hostId: 'runtime:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    })

    expect(fromClientA.hostId).toBe(fromClientB.hostId)
  })
})
