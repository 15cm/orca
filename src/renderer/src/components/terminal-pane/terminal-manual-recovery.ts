/**
 * User-invoked terminal rescue (Window > Recover Terminal).
 *
 * The automatic recovery layers each cover one failure and each waits for its own
 * trigger: wake recovery needs a focus/visibility event, the delivery watchdog needs
 * two stalled ticks plus main-side ACK silence, and the visibility resume only runs on
 * a tab transition. None of them repairs *input*, which is the symptom that leaves
 * closing and reopening the tab as the only way out.
 *
 * This runs every repair at once, on demand, and reports what it found — the report is
 * how we identify which layer is actually failing in the field.
 */
import type { PaneManager } from '@/lib/pane-manager/pane-manager'
import { getDriverForPty } from '@/lib/pane-manager/mobile-driver-state'
import { recoverVisibleTerminalWindowWake } from './terminal-visibility-resume'
import { focusActivePane } from './pane-helpers'
import {
  declareRendererPtyDeliveryVisible,
  setRendererPtyVisibilityClaim
} from './pty-renderer-delivery-claims'
import { forceTerminalDeliveryHeal } from './terminal-delivery-watchdog'
import { restoreTerminalFitsToDesktop } from './terminal-fit-restore'
import type { TerminalFitRestoreSettings } from './terminal-fit-restore'
import type { PtyTransport } from './pty-transport'

export type TerminalRecoveryReport = {
  /** Panes whose visibility claim was re-declared to main. */
  revisiblePtyCount: number
  /** Panes whose size was re-asserted to the PTY host. */
  resizedPaneCount: number
  /** True when the delivery heal actually ran (it needs a live report channel). */
  deliveryHealed: boolean
  /** PTYs still held by a mobile presence lock that this run tried to take back. */
  mobileLockedPtyCount: number
  /** Steps that threw. A rescue never aborts halfway, so failures are reported, not raised. */
  failedSteps: string[]
}

export type TerminalManualRecoveryArgs = {
  manager: PaneManager
  isActive: boolean
  paneTransports: ReadonlyMap<number, PtyTransport>
  settings: TerminalFitRestoreSettings
}

function emptyReport(): TerminalRecoveryReport {
  return {
    revisiblePtyCount: 0,
    resizedPaneCount: 0,
    deliveryHealed: false,
    mobileLockedPtyCount: 0,
    failedSteps: []
  }
}

// Why: every step is independent and best-effort — one failing repair must not deny the user the rest.
async function runStep(
  report: TerminalRecoveryReport,
  name: string,
  step: () => void | Promise<void>
): Promise<void> {
  try {
    await step()
  } catch {
    report.failedSteps.push(name)
  }
}

/** Local PTYs only: remote-runtime ids ride a relay outside main's renderer-visibility registry. */
function isLocalPtyId(ptyId: string | null): ptyId is string {
  return typeof ptyId === 'string' && ptyId.length > 0 && !ptyId.startsWith('remote:')
}

export async function recoverTerminalManually({
  manager,
  isActive,
  paneTransports,
  settings
}: TerminalManualRecoveryArgs): Promise<TerminalRecoveryReport> {
  const report = emptyReport()

  await runStep(report, 'render', () => {
    recoverVisibleTerminalWindowWake({
      manager,
      isActive,
      isChatViewMode: false,
      clearGlyphAtlases: true
    })
  })

  // Why force: the user asked for this explicitly, so the guards that keep routine layout
  // work from stealing focus off an input do not apply.
  await runStep(report, 'focus', () => {
    focusActivePane(manager, { force: true })
  })

  // Why: clears a hidden mark main may still hold for this PTY — the state that silently
  // drops delivery while the pane is on screen.
  await runStep(report, 'visibility', () => {
    for (const transport of paneTransports.values()) {
      const ptyId = transport.getPtyId()
      if (!isLocalPtyId(ptyId)) {
        continue
      }
      setRendererPtyVisibilityClaim(transport, ptyId, true)
      declareRendererPtyDeliveryVisible(ptyId)
      report.revisiblePtyCount += 1
    }
  })

  await runStep(report, 'delivery', async () => {
    report.deliveryHealed = (await forceTerminalDeliveryHeal()).healed
  })

  // Why: a dropped resize leaves the PTY's grid disagreeing with the pane, which reads as a
  // dead terminal for any alt-screen TUI.
  await runStep(report, 'resize', () => {
    for (const pane of manager.getPanes()) {
      const transport = paneTransports.get(pane.id)
      if (!transport?.isConnected()) {
        continue
      }
      const { cols, rows } = pane.terminal
      if (transport.resize(cols, rows, { claim: true })) {
        report.resizedPaneCount += 1
      }
    }
  })

  // Why: a mobile client that vanished without releasing its presence lock keeps the desktop
  // keyboard paused, and the overlay that offers "Take back" may not be mounted.
  const mobileLockedPtyIds: string[] = []
  for (const transport of paneTransports.values()) {
    const ptyId = transport.getPtyId()
    if (isLocalPtyId(ptyId) && getDriverForPty(ptyId).kind === 'mobile') {
      mobileLockedPtyIds.push(ptyId)
    }
  }
  report.mobileLockedPtyCount = mobileLockedPtyIds.length
  if (mobileLockedPtyIds.length > 0) {
    await runStep(report, 'mobile-lock', async () => {
      await restoreTerminalFitsToDesktop(mobileLockedPtyIds, settings)
    })
  }

  return report
}

/** True when the run found nothing worth repairing — the user should be told that plainly. */
export function terminalRecoveryFoundNothing(report: TerminalRecoveryReport): boolean {
  return (
    !report.deliveryHealed &&
    report.mobileLockedPtyCount === 0 &&
    report.resizedPaneCount === 0 &&
    report.revisiblePtyCount === 0
  )
}
