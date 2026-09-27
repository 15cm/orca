import { useCallback, type Dispatch, type SetStateAction } from 'react'
import { toast } from 'sonner'
import { track } from '@/lib/telemetry'
import { buildImportedHookSettings } from '@/lib/setup-script-prompt'
import { translate } from '@/i18n/i18n'
import type { Repo } from '../../../../shared/repo-types'
import type { SetupScriptImportCandidate } from '../../../../shared/setup-script-imports'
import { getRepoExecutionHostId } from '../../../../shared/execution-host'
import { getRepoHostIdentity } from '@/store/slices/repo-host-identity'
import { buildSetupScriptPromptActionTelemetry } from '../../../../shared/setup-script-telemetry'
import {
  markSetupScriptPromptSaved,
  type SetupScriptPromptState
} from './setup-script-prompt-render-state'
import { showSavedInProjectSettingsToast } from './SetupScriptPromptToast'

export function useSetupScriptPromptActions(input: {
  activeRepo: Repo | null
  detectedSetupDraft: string
  mountedRef: { current: boolean }
  openLocalCommandSettings: (
    repoId: string,
    hostId: ReturnType<typeof getRepoExecutionHostId>
  ) => void
  promptState: SetupScriptPromptState | null
  setImportingRepoHostIdentity: Dispatch<SetStateAction<string | null>>
  setPromptState: Dispatch<SetStateAction<SetupScriptPromptState | null>>
  updateRepo: (
    repoId: string,
    update: { hookSettings: ReturnType<typeof buildImportedHookSettings> },
    options: { hostId: ReturnType<typeof getRepoExecutionHostId> }
  ) => Promise<boolean>
}): { handleImport: () => Promise<void> } {
  const {
    activeRepo,
    detectedSetupDraft,
    mountedRef,
    openLocalCommandSettings,
    promptState,
    setImportingRepoHostIdentity,
    setPromptState,
    updateRepo
  } = input

  const saveSetupCandidate = useCallback(
    async (candidateInput: {
      candidate: SetupScriptImportCandidate
      hasSharedHooks: boolean
      actionPrefix: 'save_detected_setup' | 'import'
      editedBeforeSave?: boolean
    }) => {
      const { candidate, hasSharedHooks, actionPrefix, editedBeforeSave } = candidateInput
      if (!activeRepo) {
        return
      }
      const importedRepoHostIdentity = getRepoHostIdentity(activeRepo)
      const importedHostId = getRepoExecutionHostId(activeRepo)
      setImportingRepoHostIdentity(importedRepoHostIdentity)
      try {
        const nextSettings = buildImportedHookSettings(activeRepo, candidate, hasSharedHooks)
        const didUpdate = await updateRepo(
          activeRepo.id,
          { hookSettings: nextSettings },
          { hostId: importedHostId }
        )
        if (!didUpdate) {
          track(
            'setup_script_prompt_action',
            buildSetupScriptPromptActionTelemetry({
              action:
                actionPrefix === 'save_detected_setup'
                  ? 'save_detected_setup_failed'
                  : 'import_failed',
              candidate,
              hasSharedHooks,
              editedBeforeSave
            })
          )
          if (mountedRef.current) {
            toast.error(
              translate(
                'auto.components.sidebar.SetupScriptPromptCard.888b83bf78',
                'Failed to save setup script'
              )
            )
          }
          return
        }
        track(
          'setup_script_prompt_action',
          buildSetupScriptPromptActionTelemetry({
            action:
              actionPrefix === 'save_detected_setup'
                ? 'save_detected_setup_completed'
                : 'import_completed',
            candidate,
            hasSharedHooks,
            editedBeforeSave
          })
        )
        if (mountedRef.current) {
          const skippedCount = candidate.unsupportedFields?.length ?? 0
          setPromptState((current) => markSetupScriptPromptSaved(current, importedRepoHostIdentity))
          showSavedInProjectSettingsToast({
            onOpenSettings: () => openLocalCommandSettings(activeRepo.id, importedHostId),
            description:
              actionPrefix === 'save_detected_setup'
                ? translate(
                    'auto.components.sidebar.SetupScriptPromptCard.a49196d538',
                    'Runs when Orca creates a new worktree.'
                  )
                : skippedCount > 0
                  ? `${skippedCount} unsupported field${skippedCount === 1 ? '' : 's'} skipped. Saved the setup command.`
                  : 'Saved the setup command.'
          })
        }
      } catch (error) {
        track(
          'setup_script_prompt_action',
          buildSetupScriptPromptActionTelemetry({
            action:
              actionPrefix === 'save_detected_setup'
                ? 'save_detected_setup_failed'
                : 'import_failed',
            candidate,
            hasSharedHooks,
            editedBeforeSave
          })
        )
        console.warn('[setup-script-prompt] Failed to save setup script:', error)
        if (mountedRef.current) {
          toast.error(
            translate(
              'auto.components.sidebar.SetupScriptPromptCard.888b83bf78',
              'Failed to save setup script'
            )
          )
        }
      } finally {
        if (mountedRef.current) {
          setImportingRepoHostIdentity((current) =>
            current === importedRepoHostIdentity ? null : current
          )
        }
      }
    },
    [
      activeRepo,
      mountedRef,
      openLocalCommandSettings,
      setImportingRepoHostIdentity,
      setPromptState,
      updateRepo
    ]
  )

  const handleImport = useCallback(async () => {
    if (!activeRepo || promptState?.status !== 'ok' || !promptState.candidate) {
      return
    }
    const isPackageManagerCandidate = promptState.candidate.provider === 'package-manager'
    const actionPrefix = isPackageManagerCandidate ? 'save_detected_setup' : 'import'
    const editedBeforeSave =
      isPackageManagerCandidate && detectedSetupDraft.trim() !== promptState.candidate.setup.trim()
    const candidate = isPackageManagerCandidate
      ? { ...promptState.candidate, setup: detectedSetupDraft.trim() }
      : promptState.candidate
    if (!candidate.setup) {
      toast.error(
        translate(
          'auto.components.sidebar.SetupScriptPromptCard.70715947fb',
          'Setup script cannot be empty'
        )
      )
      return
    }
    if (actionPrefix === 'save_detected_setup') {
      track(
        'setup_script_prompt_action',
        buildSetupScriptPromptActionTelemetry({
          action: 'save_detected_setup_clicked',
          candidate,
          hasSharedHooks: promptState.hasSharedHooks,
          editedBeforeSave
        })
      )
    }
    await saveSetupCandidate({
      candidate,
      hasSharedHooks: promptState.hasSharedHooks,
      actionPrefix,
      editedBeforeSave: isPackageManagerCandidate ? editedBeforeSave : undefined
    })
  }, [activeRepo, detectedSetupDraft, promptState, saveSetupCandidate])

  return { handleImport }
}
