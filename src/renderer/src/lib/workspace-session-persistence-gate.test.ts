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

  it('lets a scoped window write, because main rebases its write onto the keys it does not own', () => {
    // Why this flipped: the gate used to be the only thing standing between a second writer and
    // the other windows' tabs. Main now partitions the write, so a project window persists its
    // own project instead of losing it on reload. See workspace-session-window-rebase.ts.
    expect(
      shouldPersistWorkspaceSession({
        workspaceSessionReady: true,
        hydrationSucceeded: true,
        workspaceSessionAdoption: 'scoped'
      })
    ).toBe(true)
  })

  it('still refuses to write before hydration succeeded', () => {
    expect(
      shouldPersistWorkspaceSession({
        workspaceSessionReady: true,
        hydrationSucceeded: false,
        workspaceSessionAdoption: 'shared'
      })
    ).toBe(false)
  })
})
