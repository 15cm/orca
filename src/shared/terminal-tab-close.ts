export type TerminalTabCloseRequest = {
  requestId: string
  worktreeId: string
  tabId: string
  localPtyTeardownOwnedExternally?: boolean
}

export type TerminalTabCloseResponse = {
  requestId: string
  error?: string
}
