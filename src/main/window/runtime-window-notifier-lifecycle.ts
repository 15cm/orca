import type { BrowserWindow } from 'electron'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import type { createRuntimeRendererNotificationSender } from './runtime-renderer-notification-sender'
import {
  hasRuntimeWindowNotifiers,
  registerRuntimeWindowNotifier,
  unregisterRuntimeWindowNotifier
} from './runtime-window-notifier-registry'

export function registerRuntimeWindowNotifierLifecycle(
  mainWindow: BrowserWindow,
  runtime: OrcaRuntimeService,
  rendererNotifications: ReturnType<typeof createRuntimeRendererNotificationSender>
): void {
  registerRuntimeWindowNotifier({ window: mainWindow, send: rendererNotifications.send })
  mainWindow.on('closed', () => {
    unregisterRuntimeWindowNotifier(mainWindow.id)
    rendererNotifications.close()
    runtime.markGraphUnavailable(mainWindow.id)
    if (!hasRuntimeWindowNotifiers()) {
      runtime.setNotifier(null)
    }
  })
}
