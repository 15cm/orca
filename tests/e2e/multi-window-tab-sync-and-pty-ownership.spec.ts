import { test, expect } from './helpers/orca-app'
import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { ensureTerminalVisible } from './helpers/store'
import {
  focusActiveTerminalInput,
  waitForActiveTerminalManager,
  waitForActivePanePtyId,
  waitForTerminalOutput
} from './helpers/terminal'
import {
  clearTerminalPtyWriteLog,
  installTerminalPtyWriteSpy,
  readTerminalPtyWrites
} from './helpers/terminal-pty-write-spy'

test.use({ experimentalMultiWindow: true })

async function openSiblingWindow(app: ElectronApplication): Promise<Page> {
  const pagePromise = app.waitForEvent('window', { timeout: 30_000 })
  await app.evaluate(({ BrowserWindow }) => {
    const source = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed())
    if (!source) {
      throw new Error('No main window')
    }
    const modifiers = process.platform === 'darwin' ? ['meta', 'alt'] : ['control', 'alt']
    source.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'N', modifiers })
    source.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'N', modifiers })
  })
  const page = await pagePromise
  await page.waitForLoadState('domcontentloaded')
  await page.waitForFunction(() => Boolean(window.__store), null, { timeout: 30_000 })
  return page
}

async function catalogTabs(
  page: Page
): Promise<
  {
    id: string
    contentType: string
    label: string
    backingState?: unknown
    terminalBinding?: unknown
  }[]
> {
  return page.evaluate(() => {
    const state = window.__store?.getState()
    return Object.values(state?.unifiedTabsByWorktree ?? {})
      .flat()
      .map((tab) => {
        const terminal = state?.terminalLayoutsByTabId?.[tab.id]
        const browser = Object.values(state?.browserTabsByWorktree ?? {})
          .flat()
          .find((candidate) => candidate.id === tab.id)
        return {
          id: tab.id,
          contentType: tab.contentType,
          label: tab.label,
          backingState:
            tab.contentType === 'terminal'
              ? { kind: 'terminal', ptyIds: Object.values(terminal?.ptyIdsByLeafId ?? {}) }
              : tab.contentType === 'browser'
                ? { kind: 'browser', browserWorkspaceId: browser?.id, pages: browser?.pageIds }
                : tab.contentType === 'simulator'
                  ? { kind: 'simulator', simulatorId: tab.entityId }
                  : {
                      kind: 'editor',
                      filePath: state?.openFiles.find((file) => file.id === tab.entityId)?.filePath
                    },
          terminalBinding:
            tab.contentType === 'terminal'
              ? { ptyId: Object.values(terminal?.ptyIdsByLeafId ?? {})[0] }
              : undefined
        }
      })
  })
}

async function createTab(
  page: Page,
  contentType: 'terminal' | 'editor' | 'browser' | 'simulator',
  id: string,
  label: string
): Promise<void> {
  await page.evaluate(
    ({ contentType, id, label }) => {
      const state = window.__store?.getState()
      const worktreeId = state?.activeWorktreeId
      if (!state || !worktreeId) {
        throw new Error('No active worktree')
      }
      state.createUnifiedTab(worktreeId, contentType, {
        id,
        label,
        activate: false,
        recordInteraction: false
      })
    },
    { contentType, id, label }
  )
}

test('shared catalog alternates lifecycle changes and hydrates a late window', async ({
  electronApp,
  orcaPage
}) => {
  const sibling = await openSiblingWindow(electronApp)
  await expect(orcaPage.locator('body')).toBeVisible()
  await expect(sibling.locator('body')).toBeVisible()
  // Catalog subscription hydrates existing tabs before accepting local mutations.
  await orcaPage.waitForTimeout(1_000)
  await sibling.waitForTimeout(1_000)
  await createTab(orcaPage, 'terminal', 'sync-terminal', 'Terminal A')
  await createTab(sibling, 'editor', 'sync-editor', 'Editor B')
  await createTab(orcaPage, 'browser', 'sync-browser', 'Browser A')
  await createTab(sibling, 'simulator', 'sync-simulator', 'Simulator B')
  await expect
    .poll(() => catalogTabs(orcaPage), { timeout: 15_000 })
    .toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'sync-terminal',
          contentType: 'terminal',
          label: 'Terminal A'
        }),
        expect.objectContaining({ id: 'sync-editor', contentType: 'editor', label: 'Editor B' }),
        expect.objectContaining({ id: 'sync-browser', contentType: 'browser', label: 'Browser A' }),
        expect.objectContaining({
          id: 'sync-simulator',
          contentType: 'simulator',
          label: 'Simulator B'
        })
      ])
    )
  await expect
    .poll(() => catalogTabs(sibling), { timeout: 15_000 })
    .toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'sync-terminal' }),
        expect.objectContaining({ id: 'sync-editor' }),
        expect.objectContaining({ id: 'sync-browser' }),
        expect.objectContaining({ id: 'sync-simulator' })
      ])
    )
  const converged = await catalogTabs(sibling)
  expect(converged.find((tab) => tab.id === 'sync-terminal')?.backingState).toEqual(
    expect.objectContaining({ kind: 'terminal' })
  )
  expect(converged.find((tab) => tab.id === 'sync-browser')?.backingState).toEqual(
    expect.objectContaining({ kind: 'browser' })
  )
  expect(converged.find((tab) => tab.id === 'sync-simulator')?.backingState).toEqual(
    expect.objectContaining({ kind: 'simulator' })
  )

  // Rename from alternating windows; labels are catalog-backed metadata, not DOM-only state.
  await orcaPage.evaluate(() =>
    window.__store?.getState().setTabLabel('sync-terminal', 'Terminal A renamed')
  )
  await sibling.evaluate(() =>
    window.__store?.getState().setTabLabel('sync-editor', 'Editor B renamed')
  )
  await orcaPage.evaluate(() =>
    window.__store?.getState().setTabLabel('sync-browser', 'Browser A renamed')
  )
  await sibling.evaluate(() =>
    window.__store?.getState().setTabLabel('sync-simulator', 'Simulator B renamed')
  )
  await expect
    .poll(() => catalogTabs(sibling), { timeout: 15_000 })
    .toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'sync-terminal', label: 'Terminal A renamed' }),
        expect.objectContaining({ id: 'sync-editor', label: 'Editor B renamed' }),
        expect.objectContaining({ id: 'sync-browser', label: 'Browser A renamed' }),
        expect.objectContaining({ id: 'sync-simulator', label: 'Simulator B renamed' })
      ])
    )

  const uiBefore = await orcaPage.evaluate(() => {
    const state = window.__store?.getState()
    return {
      activeTabId: state?.activeTabId,
      activeGroupId: state?.activeGroupId,
      layout: state?.tabGroups,
      preview: state?.previewTabId
    }
  })
  await orcaPage.evaluate(() => {
    const state = window.__store?.getState()
    const tab = Object.values(state?.unifiedTabsByWorktree ?? {})
      .flat()
      .find((candidate) => candidate.id === 'sync-editor')
    if (tab) {
      state?.closeUnifiedTab(tab.id, { recordInteraction: false, worktreeId: tab.worktreeId })
    }
  })
  await expect
    .poll(() => catalogTabs(sibling), { timeout: 15_000 })
    .toEqual(expect.not.arrayContaining([expect.objectContaining({ id: 'sync-editor' })]))
  expect(
    await orcaPage.evaluate(() => {
      const state = window.__store?.getState()
      return {
        activeTabId: state?.activeTabId,
        activeGroupId: state?.activeGroupId,
        layout: state?.tabGroups,
        preview: state?.previewTabId
      }
    })
  ).toEqual(uiBefore)

  const third = await openSiblingWindow(electronApp)
  await expect
    .poll(() => catalogTabs(third), { timeout: 15_000 })
    .toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'sync-terminal', label: 'Terminal A renamed' }),
        expect.objectContaining({ id: 'sync-browser', label: 'Browser A renamed' }),
        expect.objectContaining({ id: 'sync-simulator', label: 'Simulator B renamed' })
      ])
    )
})

test('equal tab IDs hydrate independently across Git, folder, and SSH catalog partitions', async ({
  electronApp,
  orcaPage
}) => {
  const sibling = await openSiblingWindow(electronApp)
  const before = await orcaPage.evaluate(() => ({
    tab: window.__store?.getState().activeTabId,
    group: window.__store?.getState().activeGroupId
  }))
  const partitions = [
    { executionHostId: 'local', workspaceKey: 'repo::same' },
    { executionHostId: 'local', workspaceKey: 'folder:/tmp/same' },
    { executionHostId: 'ssh:host-a', workspaceKey: 'repo::same' }
  ]
  await orcaPage.evaluate(async (partitions) => {
    for (const [index, key] of partitions.entries()) {
      await window.api.app.tabs.catalogMutate({
        mutationId: `equal-create-${index}`,
        kind: 'create',
        key,
        tab: {
          tabId: 'equal-id',
          contentType: 'editor',
          metadata: {
            entityId: `file-${index}`,
            label: `Partition ${index}`,
            customLabel: null,
            color: null
          },
          backingState: {
            kind: 'editor',
            filePath: `/tmp/partition-${index}.ts`,
            language: 'typescript'
          }
        }
      })
    }
  }, partitions)
  const third = await openSiblingWindow(electronApp)
  await expect
    .poll(() => third.evaluate(() => window.api.app.tabs.catalogBootstrapAll()), {
      timeout: 15_000
    })
    .toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: partitions[0],
          tabs: [expect.objectContaining({ tabId: 'equal-id' })]
        }),
        expect.objectContaining({
          key: partitions[1],
          tabs: [expect.objectContaining({ tabId: 'equal-id' })]
        }),
        expect.objectContaining({
          key: partitions[2],
          tabs: [expect.objectContaining({ tabId: 'equal-id' })]
        })
      ])
    )
  await sibling.evaluate(async (key) => {
    await window.api.app.tabs.catalogMutate({
      mutationId: 'equal-close-ssh',
      kind: 'close',
      key,
      tabId: 'equal-id'
    })
  }, partitions[2])
  await expect
    .poll(
      () =>
        third.evaluate(() =>
          window.api.app.tabs.catalogBootstrap({
            executionHostId: 'ssh:host-a',
            workspaceKey: 'repo::same'
          })
        ),
      { timeout: 15_000 }
    )
    .toMatchObject({ tabs: [], tombstones: ['equal-id'] })
  await expect
    .poll(() =>
      orcaPage.evaluate(() => ({
        tab: window.__store?.getState().activeTabId,
        group: window.__store?.getState().activeGroupId
      }))
    )
    .toEqual(before)
})

test('two real windows transfer focused terminal input and preserve visible output @headful', async ({
  electronApp,
  orcaPage
}) => {
  await ensureTerminalVisible(orcaPage)
  await waitForActiveTerminalManager(orcaPage)
  const sibling = await openSiblingWindow(electronApp)
  await ensureTerminalVisible(sibling)
  await waitForActiveTerminalManager(sibling)
  await installTerminalPtyWriteSpy(electronApp)
  const ptyId = await waitForActivePanePtyId(sibling)
  await clearTerminalPtyWriteLog(electronApp)

  await sibling.bringToFront()
  await focusActiveTerminalInput(sibling)
  await sibling.keyboard.type('Z')
  await expect.poll(() => readTerminalPtyWrites(electronApp), { timeout: 10_000 }).toEqual(['Z'])
  await sibling.keyboard.press('Enter')
  await clearTerminalPtyWriteLog(electronApp)
  await sibling.keyboard.type("printf 'transfer-output'")
  await sibling.keyboard.press('Enter')
  await waitForTerminalOutput(sibling, 'transfer-output')

  await orcaPage.bringToFront()
  await focusActiveTerminalInput(orcaPage)
  await orcaPage.keyboard.type('Y')
  await expect
    .poll(() => readTerminalPtyWrites(electronApp), { timeout: 10_000 })
    .toEqual(['Z', 'Y'])
  await sibling.evaluate((id) => window.api.pty.write(id, 'STALE'), ptyId)
  await sibling.waitForTimeout(100)
  expect(await readTerminalPtyWrites(electronApp)).toEqual(['Z', 'Y'])
})
