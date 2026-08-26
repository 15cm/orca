import { useEffect } from 'react'
import { useAppStore } from '../store'
import { useWindowScopeProject } from '../components/sidebar/use-window-scope-project'

/**
 * Keeps this window in step with main's view of its scope: applies rebinds pushed by main
 * ("change project", "free mode", a deleted group) and reports the resolved project name so the
 * window title can carry it (main cannot name a remote host's group by itself).
 */
export function useWindowScopeSync(): void {
  const applyWindowScopeChange = useAppStore((s) => s.applyWindowScopeChange)
  const { scope, group } = useWindowScopeProject()

  useEffect(
    () => window.api.ui.onWindowScopeChanged(applyWindowScopeChange),
    [applyWindowScopeChange]
  )

  useEffect(() => {
    if (!scope) {
      return
    }
    window.api.ui.setWindowScopeLabel(group?.name ?? null)
  }, [scope, group?.name])
}
