import { describe, expect, it } from 'vitest'
import { shouldPersistWorkspaceSession } from './workspace-session-persistence-gate'

describe('shouldPersistWorkspaceSession', () => {
  it('returns false before either flag is set', () => {
    expect(
      shouldPersistWorkspaceSession({
        workspaceSessionReady: false,
        hydrationSucceeded: false,
        workspaceSessionAdoption: 'shared'
      })
    ).toBe(false)
  })

  it('returns false when the UI is ready but hydration failed', () => {
    // Why: the error path mounts the UI but must keep the session writer
    // closed so an empty in-memory session cannot overwrite disk.
    expect(
      shouldPersistWorkspaceSession({
        workspaceSessionReady: true,
        hydrationSucceeded: false,
        workspaceSessionAdoption: 'shared'
      })
    ).toBe(false)
  })

  it('returns false when hydration finished but UI is not ready yet', () => {
    expect(
      shouldPersistWorkspaceSession({
        workspaceSessionReady: false,
        hydrationSucceeded: true,
        workspaceSessionAdoption: 'shared'
      })
    ).toBe(false)
  })

  it('returns true only when both flags are set', () => {
    expect(
      shouldPersistWorkspaceSession({
        workspaceSessionReady: true,
        hydrationSucceeded: true,
        workspaceSessionAdoption: 'shared'
      })
    ).toBe(true)
  })

  it('returns false for a window that opened with nothing open, however far startup got', () => {
    // Why: this window hydrated no session, so its writes would replace every keyed map on
    // disk with the empty one it holds — the other windows' tabs and the next launch's.
    expect(
      shouldPersistWorkspaceSession({
        workspaceSessionReady: true,
        hydrationSucceeded: true,
        workspaceSessionAdoption: 'empty'
      })
    ).toBe(false)
  })
})
