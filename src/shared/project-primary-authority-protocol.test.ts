import { describe, expect, it } from 'vitest'
import { ProjectPrimaryAuthorityWorkspaceParams } from './project-primary-authority-protocol'

describe('ProjectPrimaryAuthorityWorkspaceParams', () => {
  it('accepts canonical native hosts and rejects encoded aliases', () => {
    const base = {
      worktreeId: 'repo-a::/repo',
      instanceId: 'instance-a',
      path: '/repo',
      peerFingerprint: 'peer-a',
      authorityFingerprint: 'peer-a'
    }

    expect(ProjectPrimaryAuthorityWorkspaceParams.safeParse({ ...base, hostId: 'ssh:a' }).success).toBe(
      true
    )
    expect(
      ProjectPrimaryAuthorityWorkspaceParams.safeParse({ ...base, hostId: 'ssh:%61' }).success
    ).toBe(false)
  })
})
