import type { WebContents } from 'electron'
import {
  didFinishLoadHandlersByWebContents,
  rendererDidStartNavigationHandler,
  rendererGateResetGoneHandler,
  rendererGateResetLoadHandler,
  rendererGateResetWebContents,
  rendererLifecycleResetHandler,
  rendererLifecycleResetWebContents,
  setRendererGateResetState,
  setRendererLifecycleResetState
} from '../provider/listener-lifecycle'
import { mainDeliveryBreadcrumbs, resetRendererDeliveryAccountingForLifecycleReset } from './debug'
import {
  activeRendererPtys,
  invalidatePendingPtyDrainPriority,
  visibleRendererPtys
} from './visibility-state'

export function clearDidFinishLoadHandler(): void {
  for (const [contents, handler] of didFinishLoadHandlersByWebContents) {
    contents.removeListener('did-finish-load', handler)
  }
  didFinishLoadHandlersByWebContents.clear()
}

export function markRendererPtysHiddenForRendererLifecycleReset(): void {
  // A reload/crash in the breadcrumb history is load-bearing context for any freeze report.
  mainDeliveryBreadcrumbs.record('renderer-lifecycle-reset')
  // Why: renderer-owned hints die with the page; clear visibility so surviving daemon/SSH PTYs fail closed until the new renderer reports.
  const activePriorityChanged = activeRendererPtys.size > 0
  activeRendererPtys.clear()
  visibleRendererPtys.clear()
  // Why: the dead page never ACKs its in-flight bytes, so leaked accounting would delivery-gate surviving PTYs forever after a reload/crash.
  resetRendererDeliveryAccountingForLifecycleReset()
  if (activePriorityChanged) {
    invalidatePendingPtyDrainPriority()
  }
}

export function clearRendererLifecycleResetHandlers(): void {
  if (!rendererLifecycleResetWebContents) {
    return
  }
  if (rendererDidStartNavigationHandler) {
    rendererLifecycleResetWebContents.removeListener(
      'did-start-navigation',
      rendererDidStartNavigationHandler
    )
  }
  if (rendererLifecycleResetHandler) {
    rendererLifecycleResetWebContents.removeListener(
      'render-process-gone',
      rendererLifecycleResetHandler
    )
    rendererLifecycleResetWebContents.removeListener('destroyed', rendererLifecycleResetHandler)
  }
  setRendererLifecycleResetState({ contents: null, handler: null, navigation: null })
}

export function registerRendererLifecycleResetHandlers(webContents: WebContents): void {
  const previousWebContents = rendererLifecycleResetWebContents
  clearRendererLifecycleResetHandlers()
  // Why conditional: opening a second window re-registers here and is not a page death. Wiping
  // visibility while leaving rendererVisibilityKnownPtys intact makes every live PTY read as
  // hidden, so its output ships `background: true` and the renderer drops the frame for any
  // alt-screen TUI. A real reload/crash still resets through the listeners installed below.
  const previousRendererGone =
    !previousWebContents ||
    previousWebContents === webContents ||
    (typeof previousWebContents.isDestroyed === 'function' && previousWebContents.isDestroyed())
  if (previousRendererGone) {
    markRendererPtysHiddenForRendererLifecycleReset()
  }
  const handler = markRendererPtysHiddenForRendererLifecycleReset
  const navigationHandler = (details: { isMainFrame: boolean; isSameDocument: boolean }) => {
    if (!details.isMainFrame || details.isSameDocument) {
      return
    }
    markRendererPtysHiddenForRendererLifecycleReset()
  }
  setRendererLifecycleResetState({
    contents: webContents,
    handler,
    navigation: navigationHandler
  })
  webContents.on('did-start-navigation', navigationHandler)
  webContents.on('render-process-gone', handler)
  webContents.on('destroyed', handler)
}

export function clearRendererGateResetHandlers(): void {
  if (rendererGateResetWebContents) {
    if (rendererGateResetLoadHandler) {
      rendererGateResetWebContents.removeListener('did-finish-load', rendererGateResetLoadHandler)
    }
    if (rendererGateResetGoneHandler) {
      rendererGateResetWebContents.removeListener(
        'render-process-gone',
        rendererGateResetGoneHandler
      )
    }
  }
  setRendererGateResetState({ contents: null, load: null, gone: null })
}
