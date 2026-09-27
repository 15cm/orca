import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '@/store'
import { track } from '@/lib/telemetry'
import { useMountedRef } from '@/hooks/useMountedRef'
import {
  formatCandidateProvenance,
  formatCandidateSource,
  isSetupScriptPromptDismissed,
  ignoresSharedSetupScripts,
  inspectSetupScriptPromptState,
  shouldSuppressSetupScriptPrompt
} from '@/lib/setup-script-prompt'
import { checkRuntimeHooks, inspectRuntimeSetupScriptImports } from '@/runtime/runtime-hooks-client'
import { isGitRepoKind } from '../../../../shared/repo-kind'
import { buildSetupScriptPromptActionTelemetry } from '../../../../shared/setup-script-telemetry'
import { SetupScriptPromptCardShell } from './SetupScriptPromptCardShell'
import { openSetupScriptSettings } from './open-setup-script-settings'
import { trackSetupScriptPromptExposure } from './setup-script-prompt-exposure-telemetry'
import {
  findSetupScriptPromptRepo,
  type SetupScriptPromptState
} from './setup-script-prompt-render-state'
import { useSetupScriptPromptRevalidation } from './useSetupScriptPromptRevalidation'
import { useRenderedSetupScriptPromptState } from './useRenderedSetupScriptPromptState'
import { useSetupScriptPromptActions } from './useSetupScriptPromptActions'
import { getRepoHostIdentity } from '@/store/slices/repo-host-identity'
import { getRepoExecutionHostId } from '../../../../shared/execution-host'
import { useWorktreeById } from '@/store/selectors'

function SetupScriptPromptCard(): React.JSX.Element | null {
  const sidebarOpen = useAppStore((s) => s.sidebarOpen)
  const repos = useAppStore((s) => s.repos)
  const activeRepoId = useAppStore((s) => s.activeRepoId)
  const activeWorktreeId = useAppStore((s) => s.activeWorktreeId)
  const activeWorktree = useWorktreeById(activeWorktreeId)
  const settings = useAppStore((s) => s.settings)
  const updateRepo = useAppStore((s) => s.updateRepo)
  const openSettingsPage = useAppStore((s) => s.openSettingsPage)
  const openSettingsTarget = useAppStore((s) => s.openSettingsTarget)
  const setSettingsSearchQuery = useAppStore((s) => s.setSettingsSearchQuery)
  const dismissedRepoIds = useAppStore((s) => s.setupScriptPromptDismissedRepoIds)
  const dismissSetupScriptPrompt = useAppStore((s) => s.dismissSetupScriptPrompt)
  const [promptState, setPromptState] = useState<SetupScriptPromptState | null>(null)
  const [detectedSetupDraft, setDetectedSetupDraft] = useState('')
  const [importingRepoHostIdentity, setImportingRepoHostIdentity] = useState<string | null>(null)
  const [inspectionRetryKey, setInspectionRetryKey] = useState(0)
  const trackedPromptKeysRef = useRef<Set<string>>(new Set())
  const mountedRef = useMountedRef()

  const activeRepo = useMemo(
    () => findSetupScriptPromptRepo({ repos, activeRepoId, activeWorktree, settings }),
    [activeRepoId, activeWorktree, repos, settings]
  )
  const activeRepoHostIdentity = activeRepo ? getRepoHostIdentity(activeRepo) : null
  const isDismissed = activeRepoHostIdentity
    ? isSetupScriptPromptDismissed(activeRepoHostIdentity, dismissedRepoIds)
    : false
  const setupPromptSuppressed = activeRepo
    ? shouldSuppressSetupScriptPrompt(activeRepo, settings)
    : false

  useEffect(() => {
    if (
      !sidebarOpen ||
      !activeRepo ||
      !isGitRepoKind(activeRepo) ||
      isDismissed ||
      setupPromptSuppressed
    ) {
      setPromptState(null)
      setDetectedSetupDraft('')
      return
    }

    const repo = activeRepo
    let cancelled = false
    setPromptState(null)

    async function inspectRepoSetup(): Promise<void> {
      const hostId = getRepoExecutionHostId(repo)
      const inspection = await inspectSetupScriptPromptState({
        repo,
        checkHooks: () => checkRuntimeHooks(settings, repo.id, hostId),
        inspectImports: () => inspectRuntimeSetupScriptImports(settings, repo.id, hostId)
      })
      if (!cancelled) {
        const nextState = {
          ...inspection,
          repoHostIdentity: getRepoHostIdentity(repo)
        }
        setPromptState(nextState)
        setDetectedSetupDraft(
          nextState.status === 'ok' && nextState.candidate?.provider === 'package-manager'
            ? nextState.candidate.setup
            : ''
        )
      }
    }

    void inspectRepoSetup()

    return () => {
      cancelled = true
    }
  }, [activeRepo, inspectionRetryKey, isDismissed, settings, setupPromptSuppressed, sidebarOpen])

  const openLocalCommandSettings = useCallback(
    (repoId: string, hostId: ReturnType<typeof getRepoExecutionHostId>) =>
      openSetupScriptSettings({
        repoId,
        hostId,
        setSettingsSearchQuery,
        openSettingsTarget,
        openSettingsPage
      }),
    [openSettingsPage, openSettingsTarget, setSettingsSearchQuery]
  )

  const handleRetryInspection = useCallback(() => {
    setInspectionRetryKey((value) => value + 1)
  }, [])

  useSetupScriptPromptRevalidation({
    activeRepo,
    isDismissed: isDismissed || setupPromptSuppressed,
    sidebarOpen,
    promptState,
    requestRevalidation: handleRetryInspection
  })

  useEffect(() => {
    if (
      !sidebarOpen ||
      !activeRepo ||
      !isGitRepoKind(activeRepo) ||
      isDismissed ||
      setupPromptSuppressed ||
      promptState?.repoId !== activeRepo.id ||
      promptState.repoHostIdentity !== activeRepoHostIdentity ||
      promptState.status !== 'ok' ||
      promptState.hasEffectiveSetup
    ) {
      return
    }

    trackSetupScriptPromptExposure({
      repoId: activeRepo.id,
      repoHostIdentity: activeRepoHostIdentity,
      promptState,
      trackedPromptKeys: trackedPromptKeysRef.current
    })
  }, [
    activeRepo,
    activeRepoHostIdentity,
    isDismissed,
    promptState,
    setupPromptSuppressed,
    sidebarOpen
  ])

  const handleConfigure = useCallback(() => {
    if (!activeRepo) {
      return
    }
    if (
      promptState?.repoId === activeRepo.id &&
      promptState.repoHostIdentity === activeRepoHostIdentity &&
      promptState.status === 'ok' &&
      !promptState.hasEffectiveSetup
    ) {
      track(
        'setup_script_prompt_action',
        buildSetupScriptPromptActionTelemetry({
          action: 'configure_clicked',
          candidate: promptState.candidate,
          hasSharedHooks: promptState.hasSharedHooks
        })
      )
    }
    openLocalCommandSettings(activeRepo.id, getRepoExecutionHostId(activeRepo))
  }, [activeRepo, activeRepoHostIdentity, openLocalCommandSettings, promptState])

  const handleDismiss = useCallback(() => {
    if (activeRepo && activeRepoHostIdentity) {
      if (
        promptState?.repoId === activeRepo.id &&
        promptState.repoHostIdentity === activeRepoHostIdentity &&
        promptState.status === 'ok' &&
        !promptState.hasEffectiveSetup
      ) {
        track(
          'setup_script_prompt_action',
          buildSetupScriptPromptActionTelemetry({
            action: 'dismissed',
            candidate: promptState.candidate,
            hasSharedHooks: promptState.hasSharedHooks
          })
        )
      }
      dismissSetupScriptPrompt(activeRepoHostIdentity)
    }
  }, [activeRepo, activeRepoHostIdentity, dismissSetupScriptPrompt, promptState])

  const { handleImport } = useSetupScriptPromptActions({
    activeRepo,
    detectedSetupDraft,
    mountedRef,
    openLocalCommandSettings,
    promptState,
    setImportingRepoHostIdentity,
    setPromptState,
    updateRepo
  })

  const promptTargetHidden =
    !sidebarOpen ||
    !activeRepo ||
    !activeRepoHostIdentity ||
    !isGitRepoKind(activeRepo) ||
    isDismissed ||
    setupPromptSuppressed
  const renderedPromptState = useRenderedSetupScriptPromptState({
    promptState,
    activeRepoId: activeRepo?.id ?? null,
    activeRepoHostIdentity,
    promptTargetHidden
  })

  if (
    promptTargetHidden ||
    !activeRepo ||
    !renderedPromptState ||
    (renderedPromptState.status === 'ok' && renderedPromptState.hasEffectiveSetup)
  ) {
    return null
  }

  // Why: a forbidden (mobile-scope) inspection is permanent, so suppress the
  // retry-able card entirely — the global scope-mismatch banner explains it and
  // a retry would just re-fire repo.hooksCheck on every repo focus.
  if (renderedPromptState.status === 'forbidden') {
    return null
  }

  const isInspectionError = renderedPromptState.status === 'error'
  const candidate = renderedPromptState.status === 'ok' ? renderedPromptState.candidate : null
  const isPackageManagerSuggestion = candidate?.provider === 'package-manager'
  const sharedSetupIgnored =
    renderedPromptState.status === 'ok' &&
    candidate === null &&
    ignoresSharedSetupScripts(activeRepo)
  const candidateSource = candidate ? formatCandidateSource(candidate) : null
  const candidateProvenance = candidate ? formatCandidateProvenance(candidate) : null

  return (
    <SetupScriptPromptCardShell
      repoBadgeColor={activeRepo.badgeColor}
      repoDisplayName={activeRepo.displayName}
      isInspectionError={isInspectionError}
      sharedSetupIgnored={sharedSetupIgnored}
      isPackageManagerSuggestion={Boolean(isPackageManagerSuggestion && candidate)}
      hasCandidate={Boolean(candidate)}
      candidateSource={candidateSource}
      candidateProvenance={candidateProvenance}
      detectedSetupDraft={detectedSetupDraft}
      isImporting={importingRepoHostIdentity === activeRepoHostIdentity}
      renderedStateOk={renderedPromptState.status === 'ok'}
      onDismiss={handleDismiss}
      onRetryInspection={handleRetryInspection}
      onConfigure={handleConfigure}
      onImport={() => void handleImport()}
      onSetupDraftChange={setDetectedSetupDraft}
    />
  )
}

export default React.memo(SetupScriptPromptCard)
