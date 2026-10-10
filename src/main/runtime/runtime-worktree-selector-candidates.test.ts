import { describe, expect, it } from 'vitest'
import type { ResolvedWorktree } from './runtime-worktree-path-identity'
import { matchWorktreeSelectorCandidates } from './runtime-worktree-selector-candidates'

const row = (id: string, hostId: string): ResolvedWorktree =>
  ({
    id,
    repoId: id.split('::')[0],
    path: '/same/path',
    head: 'head',
    branch: 'feature',
    isBare: false,
    isMainWorktree: false,
    hostId
  }) as ResolvedWorktree

describe('matchWorktreeSelectorCandidates', () => {
  it('deduplicates equivalent paths on one host while preserving cross-host ambiguity', () => {
    const sameHost = [row('repo-a::/same/path', 'local'), row('repo-b::/same/path', 'local')]
    expect(matchWorktreeSelectorCandidates('path:/same/path', sameHost)).toEqual([sameHost[0]])

    const differentHosts = [
      row('repo-a::/same/path', 'local'),
      row('repo-b::/same/path', 'ssh:host-a')
    ]
    expect(matchWorktreeSelectorCandidates('path:/same/path', differentHosts)).toEqual(
      differentHosts
    )
  })

  it('keeps exact IDs first and normalizes a scoped filesystem ID fallback', () => {
    const rows = [row('repo-a::C:/same/path', 'local'), row('repo-a::D:/same/path', 'local')]
    expect(matchWorktreeSelectorCandidates('id:repo-a::C:/same/path', rows)).toEqual([rows[0]])
    expect(matchWorktreeSelectorCandidates('id:repo-a::c:\\same\\path', rows)).toEqual([rows[0]])
  })
})
