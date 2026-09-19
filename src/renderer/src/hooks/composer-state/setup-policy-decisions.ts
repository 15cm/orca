import type {
  RepoHookSettings,
  SetupAgentStartupPolicy
} from '../../../../shared/orca-yaml-hook-types'

export function getRepoSetupAgentStartupPolicy(repo?: {
  hookSettings?: Pick<RepoHookSettings, 'setupAgentStartupPolicy'>
}): SetupAgentStartupPolicy {
  return repo?.hookSettings?.setupAgentStartupPolicy ?? 'start-immediately'
}

export function buildSetupAgentStartupHookSettings(
  current: RepoHookSettings | undefined,
  setupAgentStartupPolicy: SetupAgentStartupPolicy
): RepoHookSettings {
  return {
    mode: current?.mode ?? 'auto',
    ...current,
    setupAgentStartupPolicy,
    scripts: {
      setup: '',
      archive: '',
      ...current?.scripts
    }
  }
}
