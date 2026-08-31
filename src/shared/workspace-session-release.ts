/**
 * Main telling a live window it no longer serves some workspaces, because another window took
 * the project over. Without it a project only moves on the next reload: the window it was opened
 * from is already hydrated and keeps showing the project it just handed away.
 *
 * Keys only — never state. Letting go is removal, and the window that took over reads its own
 * half from `session:get`.
 */
export const WORKSPACE_SESSION_RELEASE_CHANNEL = 'session:workspacesReleased'

export type WorkspaceSessionReleasePayload = {
  /** Session keys (worktree ids, or `folder:<id>`) this window must drop from its store. */
  workspaceKeys: string[]
}
