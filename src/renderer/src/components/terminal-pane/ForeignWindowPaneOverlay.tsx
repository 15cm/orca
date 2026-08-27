import { useCallback, useId, useRef, useState, type ReactElement } from 'react'
import { AppWindow } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import type { PtyOwnerWindowDescriptor } from '../../../../shared/pty-window-ownership'

type Props = {
  owner: PtyOwnerWindowDescriptor
  onBringHere: () => Promise<void>
  /** Identifier class on the rendered root, used by e2e selectors. */
  rootClassName?: string
}

/**
 * Sibling of MobileDriverOverlay for a pane whose PTY delivers to another window: the pane's
 * scrollback is a snapshot of the past, so say so and offer to take the terminal over here.
 * Output stays visible underneath — no scrim — because the frozen buffer is still useful context.
 */
export function ForeignWindowPaneOverlay({
  owner,
  onBringHere,
  rootClassName
}: Props): ReactElement {
  const titleId = useId()
  const bodyId = useId()
  const projectName = useAppStore((s) =>
    owner.projectGroupId === null
      ? null
      : (s.projectGroups.find((group) => group.id === owner.projectGroupId)?.name ?? null)
  )
  const [pending, setPending] = useState(false)
  const mountedRef = useRef(false)
  const setRootRef = useCallback((node: HTMLDivElement | null): void => {
    mountedRef.current = node !== null
  }, [])

  const handleBringHere = async (): Promise<void> => {
    if (pending) {
      return
    }
    setPending(true)
    try {
      await onBringHere()
    } finally {
      if (mountedRef.current) {
        setPending(false)
      }
    }
  }

  const title =
    owner.projectGroupId === null
      ? translate(
          'auto.components.terminal.pane.ForeignWindowPaneOverlay.runningInFreeWindow',
          'Running in another window'
        )
      : projectName === null
        ? translate(
            'auto.components.terminal.pane.ForeignWindowPaneOverlay.runningInProjectWindowUnnamed',
            'Running in another project window'
          )
        : translate(
            'auto.components.terminal.pane.ForeignWindowPaneOverlay.runningInProjectWindow',
            'Running in the {{project}} window',
            { project: projectName }
          )

  return (
    <div
      ref={setRootRef}
      role="status"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      className={cn(
        'pointer-events-none absolute inset-0 z-50 flex items-center justify-center p-6',
        rootClassName
      )}
    >
      <div className="pointer-events-auto flex w-full max-w-[30rem] flex-col gap-3 rounded-lg border border-border bg-card p-6 pb-5 text-card-foreground shadow-xs">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full border border-border bg-muted">
            <AppWindow className="size-5 text-foreground" aria-hidden="true" />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {translate(
                'auto.components.terminal.pane.ForeignWindowPaneOverlay.eyebrow',
                'Another window'
              )}
            </div>
            <div id={titleId} className="text-base font-semibold leading-tight">
              {title}
            </div>
          </div>
        </div>
        <div id={bodyId} className="text-sm leading-relaxed text-muted-foreground">
          {translate(
            'auto.components.terminal.pane.ForeignWindowPaneOverlay.body',
            'Output goes to that window; what you see here is a snapshot. Bring the terminal here to watch it live and type into it.'
          )}
        </div>
        <div className="mt-1 flex justify-end">
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={handleBringHere}
            disabled={pending}
          >
            {translate(
              'auto.components.terminal.pane.ForeignWindowPaneOverlay.bringHere',
              'Bring here'
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}
