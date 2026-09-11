import { useEffect } from 'react'
import { toast } from 'sonner'
import type { PaneManager } from '@/lib/pane-manager/pane-manager'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { recordTerminalFreezeBreadcrumb } from './terminal-freeze-breadcrumbs'
import {
  recoverTerminalManually,
  terminalRecoveryFoundNothing,
  type TerminalRecoveryReport
} from './terminal-manual-recovery'
import type { PtyTransport } from './pty-transport'

type UseTerminalManualRecoveryArgs = {
  managerRef: React.RefObject<PaneManager | null>
  paneTransportsRef: React.RefObject<Map<number, PtyTransport>>
  isActiveRef: React.RefObject<boolean>
  isVisibleRef: React.RefObject<boolean>
}

function describeRecovery(report: TerminalRecoveryReport): string {
  const repairs: string[] = []
  if (report.revisiblePtyCount > 0) {
    repairs.push(
      translate('auto.terminal.recovery.visibility', 're-declared visibility ({{value0}})', {
        value0: report.revisiblePtyCount
      })
    )
  }
  if (report.deliveryHealed) {
    repairs.push(translate('auto.terminal.recovery.delivery', 'healed output delivery'))
  }
  if (report.resizedPaneCount > 0) {
    repairs.push(
      translate('auto.terminal.recovery.resize', 're-sent size ({{value0}})', {
        value0: report.resizedPaneCount
      })
    )
  }
  if (report.mobileLockedPtyCount > 0) {
    repairs.push(
      translate('auto.terminal.recovery.mobileLock', 'took back {{value0}} from a phone', {
        value0: report.mobileLockedPtyCount
      })
    )
  }
  return repairs.join(' · ')
}

/**
 * Window > Recover Terminal. Every mounted pane receives the IPC, so only the visible one
 * acts — otherwise a background tab would steal focus and toast over the user's screen.
 */
export function useTerminalManualRecovery({
  managerRef,
  paneTransportsRef,
  isActiveRef,
  isVisibleRef
}: UseTerminalManualRecoveryArgs): void {
  useEffect(() => {
    if (typeof window.api?.ui?.onRecoverTerminal !== 'function') {
      return
    }
    return window.api.ui.onRecoverTerminal(() => {
      const manager = managerRef.current
      if (!manager || !isVisibleRef.current) {
        return
      }
      void recoverTerminalManually({
        manager,
        isActive: isActiveRef.current,
        paneTransports: paneTransportsRef.current,
        settings: useAppStore.getState().settings ?? undefined
      }).then((report) => {
        recordTerminalFreezeBreadcrumb('manual-recovery', {
          revisiblePtyCount: report.revisiblePtyCount,
          resizedPaneCount: report.resizedPaneCount,
          deliveryHealed: report.deliveryHealed,
          mobileLockedPtyCount: report.mobileLockedPtyCount,
          failedSteps: report.failedSteps.join(',')
        })
        if (terminalRecoveryFoundNothing(report)) {
          toast.info(
            translate('auto.terminal.recovery.nothing', 'Terminal looked healthy — repainted it')
          )
          return
        }
        toast.success(translate('auto.terminal.recovery.done', 'Terminal recovered'), {
          description: describeRecovery(report)
        })
      })
    })
  }, [managerRef, paneTransportsRef, isActiveRef, isVisibleRef])
}
