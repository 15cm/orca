import { test, expect } from './helpers/orca-app'
import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import path from 'node:path'
import {
  readPaneIdentitySnapshot,
  splitActiveTerminalPane,
  waitForActivePaneHookDescriptor,
  waitForActiveTerminalManager,
  waitForPaneIdentitySnapshot
} from './helpers/terminal'
import { emitCodexHookStatus, readHookEndpoint } from './helpers/agent-hook-endpoint'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'

test.use({ experimentalMultiWindow: true })

type NativeNotificationProbe = {
  shown: number
  clickListenerCount: number
}

async function installNativeNotificationProbe(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ Notification }) => {
    // Why: the isolated Linux GUI guest has no Electron notification backend; keep click and dedupe coverage in the main-process probe.
    Object.defineProperty(Notification, 'isSupported', {
      configurable: true,
      value: () => true,
      writable: true
    })
    const globalState = globalThis as typeof globalThis & {
      __orcaNativeNotificationProbe?: {
        shown: number
        clickListeners: (() => void)[]
      }
      __orcaNativeNotificationProbeInstalled?: boolean
    }
    if (globalState.__orcaNativeNotificationProbeInstalled) {
      return
    }
    const probe = { shown: 0, clickListeners: [] as (() => void)[] }
    const notificationPrototype = Notification.prototype as unknown as {
      show: () => void
      on: (event: string, listener: (...args: unknown[]) => void) => unknown
    }
    const originalOn = notificationPrototype.on
    notificationPrototype.show = () => {
      probe.shown += 1
    }
    notificationPrototype.on = function (this: unknown, event, listener) {
      if (event === 'click') {
        probe.clickListeners.push(listener as () => void)
      }
      return originalOn.call(this, event, listener)
    }
    globalState.__orcaNativeNotificationProbe = probe
    globalState.__orcaNativeNotificationProbeInstalled = true
  })
}

async function resetNativeNotificationProbe(app: ElectronApplication): Promise<void> {
  await app.evaluate(() => {
    const probe = (
      globalThis as typeof globalThis & {
        __orcaNativeNotificationProbe?: { shown: number; clickListeners: (() => void)[] }
      }
    ).__orcaNativeNotificationProbe
    if (probe) {
      probe.shown = 0
      probe.clickListeners.length = 0
    }
  })
}

async function readNativeNotificationProbe(
  app: ElectronApplication
): Promise<NativeNotificationProbe> {
  return app.evaluate(() => {
    const probe = (
      globalThis as typeof globalThis & {
        __orcaNativeNotificationProbe?: { shown: number; clickListeners: (() => void)[] }
      }
    ).__orcaNativeNotificationProbe
    return {
      shown: probe?.shown ?? 0,
      clickListenerCount: probe?.clickListeners.length ?? 0
    }
  })
}

async function invokeCapturedNativeNotificationClick(app: ElectronApplication): Promise<void> {
  await app.evaluate(() => {
    const probe = (
      globalThis as typeof globalThis & {
        __orcaNativeNotificationProbe?: { clickListeners: (() => void)[] }
      }
    ).__orcaNativeNotificationProbe
    const listener = probe?.clickListeners.at(-1)
    if (!listener) {
      throw new Error('No native notification click listener was captured')
    }
    listener()
  })
}

async function captureScreenshot(page: Page, screenshotPath: string): Promise<void> {
  try {
    await page.screenshot({ path: screenshotPath, timeout: 5_000 })
  } catch (error) {
    console.warn(`Screenshot unavailable: ${screenshotPath}`, error)
  }
}

async function setNotificationSettings(
  page: Page,
  updates: { agentTaskComplete?: boolean; suppressWhenFocused?: boolean }
): Promise<void> {
  await page.evaluate(async (nextUpdates) => {
    const state = window.__store?.getState()
    if (!state?.settings) {
      throw new Error('Settings unavailable')
    }
    await state.updateSettingsOrThrow({
      notifications: { ...state.settings.notifications, ...nextUpdates }
    })
  }, updates)
}

async function activateWorktreeTab(page: Page, worktreeId: string, tabId: string): Promise<void> {
  await page.evaluate(
    ({ worktreeId, tabId }) => {
      const state = window.__store?.getState()
      if (!state) {
        throw new Error('Store unavailable')
      }
      state.setActiveWorktree(worktreeId)
      state.activateTab(tabId, { worktreeId })
    },
    { worktreeId, tabId }
  )
}

async function focusPaneByLeafId(page: Page, tabId: string, leafId: string): Promise<void> {
  await page.evaluate(
    ({ tabId, leafId }) => {
      const manager = window.__paneManagers?.get(tabId)
      const pane = manager?.getPanes?.().find((candidate) => candidate.leafId === leafId)
      if (!manager || !pane) {
        throw new Error(`Pane ${leafId} was not found in tab ${tabId}`)
      }
      manager.setActivePane(pane.id, { focus: true })
    },
    { tabId, leafId }
  )
}

async function openSiblingWindow(app: ElectronApplication): Promise<Page> {
  const pagePromise = app.waitForEvent('window', { timeout: 30_000 })
  // Playwright keyboard events bypass Electron's before-input-event path.
  await app.evaluate(({ BrowserWindow }) => {
    const sourceWindow = BrowserWindow.getAllWindows().find((window) => !window.isDestroyed())
    if (!sourceWindow) {
      throw new Error('No live main window was available for the new-window shortcut')
    }
    const modifiers =
      process.platform === 'darwin' ? (['meta', 'alt'] as const) : (['control', 'alt'] as const)
    sourceWindow.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'N', modifiers })
    sourceWindow.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'N', modifiers })
  })
  const page = await pagePromise
  await page.waitForLoadState('domcontentloaded')
  await page.waitForFunction(() => Boolean(window.__store), null, { timeout: 30_000 })
  await waitForSessionReady(page, 30_000)
  return page
}

async function waitForStatus(page: Page, paneKey: string, state: string): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(
          ({ paneKey, state }) =>
            window.__store?.getState().agentStatusByPaneKey[paneKey]?.state === state,
          { paneKey, state }
        ),
      { timeout: 30_000, message: `${paneKey} did not reach ${state}` }
    )
    .toBe(true)
}

test('suppresses replay notifications and routes fresh clicks to newest exact pane window', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  await waitForSessionReady(orcaPage)
  const worktreeId = await waitForActiveWorktree(orcaPage)
  await ensureTerminalVisible(orcaPage)
  await waitForActiveTerminalManager(orcaPage, 30_000)
  await splitActiveTerminalPane(orcaPage, 'vertical')
  const firstSnapshot = await waitForPaneIdentitySnapshot(orcaPage, 2)
  const targetLeafId = firstSnapshot.activeLeafId ?? firstSnapshot.panes.at(-1)?.leafId
  const alternateLeafId = firstSnapshot.panes.find((pane) => pane.leafId !== targetLeafId)?.leafId
  if (!targetLeafId || !alternateLeafId) {
    throw new Error('Expected two stable terminal leaves')
  }
  const { paneKey } = await waitForActivePaneHookDescriptor(orcaPage)
  const endpoint = await readHookEndpoint(electronApp)
  await installNativeNotificationProbe(electronApp)

  // Seed a completed cache entry while completion notifications are disabled.
  await setNotificationSettings(orcaPage, { agentTaskComplete: false })
  const seedPrompt = `multi-window-seed-${Date.now()}`
  await emitCodexHookStatus(endpoint, { paneKey, worktreeId, state: 'working', prompt: seedPrompt })
  await waitForStatus(orcaPage, paneKey, 'working')
  await emitCodexHookStatus(endpoint, {
    paneKey,
    worktreeId,
    state: 'done',
    prompt: seedPrompt,
    lastAssistantMessage: 'Cached completion'
  })
  await waitForStatus(orcaPage, paneKey, 'done')
  await setNotificationSettings(orcaPage, { agentTaskComplete: true })
  await resetNativeNotificationProbe(electronApp)

  await activateWorktreeTab(orcaPage, worktreeId, firstSnapshot.tabId)
  await focusPaneByLeafId(orcaPage, firstSnapshot.tabId, alternateLeafId)
  const siblingPage = await openSiblingWindow(electronApp)
  await expect
    .poll(
      () =>
        siblingPage.evaluate(
          ({ worktreeId, tabId }) =>
            Boolean(
              window.__store?.getState().tabsByWorktree[worktreeId]?.some((tab) => tab.id === tabId)
            ),
          { worktreeId, tabId: firstSnapshot.tabId }
        ),
      { timeout: 30_000, message: 'Sibling window did not hydrate the target tab' }
    )
    .toBe(true)
  await activateWorktreeTab(siblingPage, worktreeId, firstSnapshot.tabId)
  const siblingSnapshot = await waitForPaneIdentitySnapshot(siblingPage, 2)
  expect(siblingSnapshot.panes.map((pane) => pane.leafId)).toContain(targetLeafId)
  await waitForStatus(siblingPage, paneKey, 'done')
  expect(await readNativeNotificationProbe(electronApp)).toEqual({
    shown: 0,
    clickListenerCount: 0
  })

  await activateWorktreeTab(orcaPage, worktreeId, firstSnapshot.tabId)
  await focusPaneByLeafId(orcaPage, firstSnapshot.tabId, alternateLeafId)
  await activateWorktreeTab(siblingPage, worktreeId, firstSnapshot.tabId)
  await focusPaneByLeafId(siblingPage, firstSnapshot.tabId, alternateLeafId)
  await setNotificationSettings(orcaPage, { suppressWhenFocused: false })
  await resetNativeNotificationProbe(electronApp)

  const freshPrompt = `multi-window-fresh-${Date.now()}`
  await emitCodexHookStatus(endpoint, {
    paneKey,
    worktreeId,
    state: 'working',
    prompt: freshPrompt
  })
  await waitForStatus(orcaPage, paneKey, 'working')
  await waitForStatus(siblingPage, paneKey, 'working')
  await emitCodexHookStatus(endpoint, {
    paneKey,
    worktreeId,
    state: 'done',
    prompt: freshPrompt,
    lastAssistantMessage: 'Fresh completion'
  })
  await waitForStatus(orcaPage, paneKey, 'done')
  await waitForStatus(siblingPage, paneKey, 'done')
  await expect
    .poll(() => readNativeNotificationProbe(electronApp), {
      timeout: 30_000,
      message: 'Fresh completion did not produce one native notification'
    })
    .toEqual({ shown: 1, clickListenerCount: 1 })

  await invokeCapturedNativeNotificationClick(electronApp)
  await expect
    .poll(() => readPaneIdentitySnapshot(siblingPage), {
      timeout: 15_000,
      message: 'Newest target-tab window did not focus the notified leaf'
    })
    .toMatchObject({ tabId: firstSnapshot.tabId, activeLeafId: targetLeafId })
  await expect
    .poll(() => readPaneIdentitySnapshot(orcaPage), {
      timeout: 5_000,
      message: 'Other matching window changed after notification click'
    })
    .toMatchObject({ tabId: firstSnapshot.tabId, activeLeafId: alternateLeafId })

  await captureScreenshot(orcaPage, path.join(testInfo.outputDir, 'first-main-window.png'))
  await captureScreenshot(siblingPage, path.join(testInfo.outputDir, 'sibling-main-window.png'))
  console.log(
    JSON.stringify({
      target: { worktreeId, tabId: firstSnapshot.tabId, paneKey, targetLeafId },
      windows: {
        first: await readPaneIdentitySnapshot(orcaPage),
        sibling: await readPaneIdentitySnapshot(siblingPage)
      },
      nativeNotification: await readNativeNotificationProbe(electronApp)
    })
  )

  const holdMs = Number(process.env.ORCA_E2E_GUI_HOLD_MS ?? 0)
  if (Number.isFinite(holdMs) && holdMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, holdMs))
  }
})
