import { describe, expect, it } from 'vitest'
import {
  formatWindowSessionAdoptionArgument,
  parseWindowSessionAdoptionFromArgv,
  resolveWindowSessionAdoption
} from './window-session-adoption'
import type { WindowScope } from './window-scope'

const PROJECT_SCOPE: WindowScope = { type: 'project-group', projectGroupId: 'group-1' }

describe('resolveWindowSessionAdoption', () => {
  it('gives a project window its own partition when another window is already up', () => {
    expect(
      resolveWindowSessionAdoption({
        scope: PROJECT_SCOPE,
        scopedWindowsEnabled: true,
        otherMainWindowsOpen: true
      })
    ).toBe('scoped')
  })

  it('adopts the shared session in the launch’s first window even when it is scoped', () => {
    // Why: relaunching Orca into a window with no workspaces or tabs is the regression this
    // rule exists to prevent — phase 2 replaces it with a partition per reopened scope.
    expect(
      resolveWindowSessionAdoption({
        scope: PROJECT_SCOPE,
        scopedWindowsEnabled: true,
        otherMainWindowsOpen: false
      })
    ).toBe('shared')
  })

  it('leaves a new free window on the shared session', () => {
    expect(
      resolveWindowSessionAdoption({
        scope: null,
        scopedWindowsEnabled: true,
        otherMainWindowsOpen: true
      })
    ).toBe('shared')
  })

  it('changes nothing while scoped windows are off', () => {
    for (const otherMainWindowsOpen of [false, true]) {
      expect(
        resolveWindowSessionAdoption({
          scope: PROJECT_SCOPE,
          scopedWindowsEnabled: false,
          otherMainWindowsOpen
        })
      ).toBe('shared')
    }
  })
})

describe('window session adoption argv', () => {
  it('round-trips through the argv flag', () => {
    expect(
      parseWindowSessionAdoptionFromArgv([
        '--orca-window-id=group:perc',
        formatWindowSessionAdoptionArgument('scoped')
      ])
    ).toBe('scoped')
  })

  it('reports null for argv without the flag or with an unknown value', () => {
    expect(parseWindowSessionAdoptionFromArgv(['--orca-window-id=win-1'])).toBeNull()
    expect(parseWindowSessionAdoptionFromArgv(['--orca-window-session=partitioned'])).toBeNull()
  })
})
