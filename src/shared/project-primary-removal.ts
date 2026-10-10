export type PrimaryWorkspaceTarget = {
  peerFingerprint: string
  hostId: string
  instanceId: string
  path?: string
}

export type PrimaryRemovalReservation = {
  token: string
  projectId: string
  target: PrimaryWorkspaceTarget
  scope?: 'owner' | 'project'
  resourceKey?: string
  requesterFingerprint?: string
}
