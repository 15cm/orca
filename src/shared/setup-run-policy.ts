import type { GlobalSettings } from './global-settings-types'
import type { Repo } from './repo-types'
import type { SetupDecision } from './worktree/create-types'
import type { SetupRunPolicy } from './orca-yaml-hook-types'

export const DEFAULT_SETUP_RUN_POLICY: SetupRunPolicy = 'run-by-default'

export function isSetupRunPolicy(value: unknown): value is SetupRunPolicy {
  return value === 'ask' || value === 'run-by-default' || value === 'skip-by-default'
}

export function normalizeSetupRunPolicy(value: unknown): SetupRunPolicy {
  return isSetupRunPolicy(value) ? value : DEFAULT_SETUP_RUN_POLICY
}

export function resolveSetupRunPolicy(
  repo: Pick<Repo, 'hookSettings'> | null | undefined,
  settings?: { defaultSetupRunPolicy?: GlobalSettings['defaultSetupRunPolicy'] } | null
): SetupRunPolicy {
  return (
    repo?.hookSettings?.setupRunPolicy ?? normalizeSetupRunPolicy(settings?.defaultSetupRunPolicy)
  )
}

export function resolveSetupRunDecision(
  repo: Pick<Repo, 'hookSettings'>,
  decision: SetupDecision = 'inherit',
  settings?: { defaultSetupRunPolicy?: GlobalSettings['defaultSetupRunPolicy'] } | null
): boolean {
  if (decision === 'run') {
    return true
  }
  if (decision === 'skip') {
    return false
  }
  const policy = resolveSetupRunPolicy(repo, settings)
  if (policy === 'ask') {
    throw new Error('Setup decision required for this repository')
  }
  return policy === 'run-by-default'
}
