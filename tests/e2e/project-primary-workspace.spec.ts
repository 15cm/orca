import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, test } from './helpers/orca-app'
import { attachRepoAndOpenTerminal, createRestartSession } from './helpers/orca-restart'
import { waitForSessionReady } from './helpers/store'
import {
  execInTerminal,
  getTerminalContent,
  waitForActivePanePtyId,
  waitForTerminalOutput
} from './helpers/terminal'
import { runProcessSync } from '../../src/shared/child-process/run-process'
import type { Page } from '@stablyai/playwright-test'

function runGit(repoPath: string, args: string[]): void {
  const result = runProcessSync({ program: 'git', args, cwd: repoPath, timeoutMs: 30_000 })
  if (result.code !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
  }
}

function makeGitRepo(): string {
  const repoPath = mkdtempSync(path.join(os.tmpdir(), 'orca-primary-e2e-'))
  runGit(repoPath, ['init'])
  runGit(repoPath, ['checkout', '-b', 'main'])
  runGit(repoPath, ['config', 'user.name', 'Orca E2E'])
  runGit(repoPath, ['config', 'user.email', 'orca-e2e@example.invalid'])
  runGit(repoPath, ['commit', '--allow-empty', '-m', 'seed'])
  return repoPath
}

async function visibleWorktreeOrder(page: Page): Promise<string[]> {
  return page
    .locator('[data-worktree-sidebar] [role="option"][data-worktree-id]')
    .evaluateAll((elements) =>
      elements
        .map((element) => ({
          id: element.getAttribute('data-worktree-id') ?? '',
          top: element.getBoundingClientRect().top
        }))
        .sort((left, right) => left.top - right.top)
        .map((entry) => entry.id)
    )
}

async function assertTerminalCwd(page: Page, repoPath: string, marker: string): Promise<void> {
  const ptyId = await waitForActivePanePtyId(page)
  const command =
    process.platform === 'win32'
      ? `Write-Output "${marker}:$PWD"`
      : `printf '%s:%s\\n' '${marker}' "$PWD"`
  await execInTerminal(page, ptyId, command)
  await waitForTerminalOutput(page, `${marker}:`)
  expect((await getTerminalContent(page)).toLowerCase()).toContain(
    `${marker}:${repoPath}`.toLowerCase()
  )
}

async function primaryIdentity(
  page: Page,
  projectId: string
): Promise<{
  worktreeId: string
  instanceId: string
  canonicalOwnerHostId: string
  path: string
  peerFingerprint: string
  authorityFingerprint: string
  revision: number
  primaryAuthorityFingerprint: string
}> {
  return page.evaluate((id) => {
    const project = window.__store!.getState().projects.find((candidate) => candidate.id === id)
    const primary = project?.primaryWorkspace
    if (
      !primary ||
      !project?.primaryAuthorityFingerprint ||
      project.primaryWorkspaceRevision == null
    ) {
      throw new Error('Project primary identity is incomplete')
    }
    if (!primary.peerFingerprint || !primary.authorityFingerprint) {
      throw new Error('Project primary peer identity is incomplete')
    }
    return {
      worktreeId: primary.worktreeId,
      instanceId: primary.instanceId,
      canonicalOwnerHostId: primary.hostId,
      path: primary.path,
      peerFingerprint: primary.peerFingerprint,
      authorityFingerprint: primary.authorityFingerprint,
      revision: project.primaryWorkspaceRevision,
      primaryAuthorityFingerprint: project.primaryAuthorityFingerprint
    }
  }, projectId)
}

async function assertSinglePrimaryBadge(page: Page): Promise<void> {
  await expect(
    page.locator('[data-worktree-sidebar]').getByText('primary', { exact: true })
  ).toHaveCount(1)
}

async function readActiveSession(page: Page): Promise<{
  activeWorktreeId: string | null
  activeTabId: string | null
  activeTabType: string
  activeRepoId: string | null
  activeWorkspaceKey: string | null
  tab: { id: string; worktreeId: string; title: string; createdAt: number } | null
}> {
  return page.evaluate(() => {
    const state = window.__store!.getState()
    const activeTab = state.activeTabId
      ? Object.values(state.tabsByWorktree)
          .flat()
          .find((tab) => tab.id === state.activeTabId)
      : undefined
    return {
      activeWorktreeId: state.activeWorktreeId,
      activeTabId: state.activeTabId,
      activeTabType: state.activeTabType,
      activeRepoId: state.activeRepoId,
      activeWorkspaceKey: state.activeWorkspaceKey,
      tab: activeTab
        ? {
            id: activeTab.id,
            worktreeId: activeTab.worktreeId,
            title: activeTab.title,
            createdAt: activeTab.createdAt
          }
        : null
    }
  })
}

// oxlint-disable-next-line no-empty-pattern -- This lifecycle scenario owns its app launches via createRestartSession.
test('promotes primary through context and picker, preserves session, and restores after restart', async ({}, testInfo) => {
  test.setTimeout(240_000)
  const repoPath = makeGitRepo()
  const restart = createRestartSession(testInfo)
  let app: Awaited<ReturnType<typeof restart.launch>>['app'] | null = null
  let projectId: string | null = null
  let expectedPrimaryIdentity: Awaited<ReturnType<typeof primaryIdentity>> | null = null
  let expectedSession: Awaited<ReturnType<typeof readActiveSession>> | null = null
  let expectedPtyId: string | null = null
  try {
    const first = await restart.launch()
    app = first.app
    const page = first.page
    await waitForSessionReady(page)
    const originalWorktreeId = await attachRepoAndOpenTerminal(page, repoPath)
    const repoId = await page.evaluate((id) => {
      const worktree = Object.values(window.__store!.getState().worktreesByRepo)
        .flat()
        .find((candidate) => candidate.id === id)
      return worktree?.repoId ?? null
    }, originalWorktreeId)
    if (!repoId) {
      throw new Error('Created original checkout workspace has no repository owner')
    }
    await assertTerminalCwd(page, repoPath, 'ORCA_PRIMARY_CWD_FIRST')
    const createdWorkspace = await page.evaluate(async (id) => {
      const state = window.__store!.getState()
      state.setGroupBy('repo')
      state.setShowSleepingWorkspaces(true)
      await state.updateSettings({ compactWorktreeCards: false })
      const created = await state.createWorktree(id, 'orca-primary-e2e-feature')
      await state.fetchWorktrees(id)
      return {
        id: created.worktree.id,
        path: created.worktree.path,
        projectId: created.worktree.projectId
      }
    }, repoId)
    const worktreeId = createdWorkspace.id
    const featurePath = createdWorkspace.path
    projectId = createdWorkspace.projectId ?? null
    if (!projectId) {
      throw new Error('Created worktree has no project owner')
    }
    await expect
      .poll(() => page.locator(`[data-worktree-id="${worktreeId}"]`).count(), { timeout: 30_000 })
      .toBeGreaterThan(0)
    const before = await readActiveSession(page)

    await page.locator(`[data-worktree-id="${worktreeId}"]`).click({ button: 'right' })
    const contextAction = page.getByRole('menuitem', { name: 'Set as primary' })
    await expect(contextAction).toBeVisible()
    await contextAction.click()
    await expect
      .poll(() =>
        page.evaluate(
          (id) =>
            window.__store!.getState().projects.find((project) => project.id === id)
              ?.primaryWorkspace?.worktreeId,
          projectId!
        )
      )
      .toBe(worktreeId)
    const featureCard = page.locator(`[data-worktree-id="${worktreeId}"]`).first()
    await expect(featureCard.getByText('primary', { exact: true })).toBeVisible()
    await assertSinglePrimaryBadge(page)
    const promotedOrder = await visibleWorktreeOrder(page)
    expect(promotedOrder.indexOf(worktreeId)).toBeLessThan(
      promotedOrder.indexOf(originalWorktreeId)
    )
    expect(await readActiveSession(page)).toEqual(before)

    await page.evaluate(() => window.__store!.getState().setHideDefaultBranchWorkspace(true))
    await expect
      .poll(() => page.locator(`[data-worktree-id="${originalWorktreeId}"]`).count())
      .toBe(0)
    await expect(page.locator(`[data-worktree-id="${worktreeId}"]`).first()).toBeVisible()
    await page.evaluate(() => window.__store!.getState().setHideDefaultBranchWorkspace(false))

    const featurePrimaryBeforeRemoval = await primaryIdentity(page, projectId!)
    const originalRemovalWhileFeaturePrimary = await page.evaluate(
      async (id) => window.__store!.getState().removeWorktree({ id, executionHostId: null }),
      originalWorktreeId
    )
    expect(originalRemovalWhileFeaturePrimary.ok).toBe(false)
    expect(existsSync(repoPath)).toBe(true)
    expect(existsSync(featurePath)).toBe(true)
    expect(
      await page.evaluate(
        (id) =>
          Object.values(window.__store!.getState().worktreesByRepo)
            .flat()
            .some((worktree) => worktree.id === id),
        originalWorktreeId
      )
    ).toBe(true)
    expect(await primaryIdentity(page, projectId!)).toEqual(featurePrimaryBeforeRemoval)

    const selectedFeatureRemoval = await page.evaluate(
      async (id) => window.__store!.getState().removeWorktree({ id, executionHostId: null }),
      worktreeId
    )
    expect(selectedFeatureRemoval.ok).toBe(false)
    expect(existsSync(repoPath)).toBe(true)
    expect(existsSync(featurePath)).toBe(true)
    expect(await primaryIdentity(page, projectId!)).toEqual(featurePrimaryBeforeRemoval)
    expect(
      await page.evaluate(
        (id) =>
          Object.values(window.__store!.getState().worktreesByRepo)
            .flat()
            .some((worktree) => worktree.id === id),
        worktreeId
      )
    ).toBe(true)

    await page.locator(`[data-worktree-id="${originalWorktreeId}"]`).click({ button: 'right' })
    const originalContextAction = page.getByRole('menuitem', { name: 'Set as primary' })
    await expect(originalContextAction).toBeVisible()
    await originalContextAction.click()
    await expect
      .poll(() => primaryIdentity(page, projectId!))
      .toMatchObject({ worktreeId: originalWorktreeId })
    await assertSinglePrimaryBadge(page)
    expect(await primaryIdentity(page, projectId!)).toMatchObject({
      worktreeId: originalWorktreeId,
      canonicalOwnerHostId: featurePrimaryBeforeRemoval.canonicalOwnerHostId
    })

    await page.evaluate((id) => {
      const state = window.__store!.getState()
      state.openSettingsTarget({ pane: 'repo', repoId: id })
      state.openSettingsPage()
    }, repoId)
    const repoSection = page.locator(`[data-settings-section="repo-${repoId}"]`)
    const primaryPicker = repoSection.getByRole('combobox')
    await expect(primaryPicker).toBeVisible()
    await primaryPicker.click()
    const pickerSearch = page.getByPlaceholder('Search workspace…')
    const featureChoice = page
      .getByRole('option')
      .filter({ hasText: 'orca-primary-e2e-feature' })
      .filter({ hasText: featurePath })
    await pickerSearch.fill('orca-primary-e2e-feature')
    await expect(featureChoice).toHaveCount(1)
    await expect(featureChoice).toBeVisible()
    await pickerSearch.fill(featurePath)
    await expect(featureChoice).toHaveCount(1)
    await expect(featureChoice).toBeVisible()
    await pickerSearch.fill('local')
    await expect(featureChoice).toHaveCount(1)
    await expect(featureChoice).toBeVisible()
    await featureChoice.click()
    await expect.poll(() => primaryIdentity(page, projectId!)).toMatchObject({ worktreeId })
    expect(await primaryIdentity(page, projectId!)).toMatchObject({ worktreeId })
    expect(await readActiveSession(page)).toEqual(before)

    await page.getByRole('button', { name: 'Back to app' }).click()
    await expect(page.locator('[data-worktree-sidebar]')).toBeVisible()

    const pickerSelectedRemoval = await page.evaluate(
      async (id) => window.__store!.getState().removeWorktree({ id, executionHostId: null }),
      worktreeId
    )
    expect(pickerSelectedRemoval.ok).toBe(false)
    expect(existsSync(featurePath)).toBe(true)
    expect(await primaryIdentity(page, projectId!)).toMatchObject({ worktreeId })

    await page.locator(`[data-worktree-id="${originalWorktreeId}"]`).click({ button: 'right' })
    const reassignContextAction = page.getByRole('menuitem', { name: 'Set as primary' })
    await expect(reassignContextAction).toBeVisible()
    await reassignContextAction.click()
    await expect
      .poll(() => primaryIdentity(page, projectId!))
      .toMatchObject({ worktreeId: originalWorktreeId })
    await expect(
      page.locator(`[data-worktree-id="${originalWorktreeId}"]`).first().getByText('primary', {
        exact: true
      })
    ).toBeVisible()
    await assertSinglePrimaryBadge(page)
    const reassignedOrder = await visibleWorktreeOrder(page)
    expect(reassignedOrder.indexOf(originalWorktreeId)).toBeLessThan(
      reassignedOrder.indexOf(worktreeId)
    )

    await page.evaluate(() => window.__store!.getState().setHideDefaultBranchWorkspace(true))
    await expect(page.locator(`[data-worktree-id="${originalWorktreeId}"]`).first()).toBeVisible()
    await page.evaluate(() => window.__store!.getState().setHideDefaultBranchWorkspace(false))

    const removalAfterReassignment = await page.evaluate(
      async (id) => window.__store!.getState().removeWorktree({ id, executionHostId: null }),
      worktreeId
    )
    expect(removalAfterReassignment.ok).toBe(true)
    await expect(page.locator(`[data-worktree-id="${worktreeId}"]`)).toHaveCount(0)

    expectedPrimaryIdentity = await primaryIdentity(page, projectId!)
    expect(expectedPrimaryIdentity.worktreeId).toBe(originalWorktreeId)
    expectedSession = before
    expectedPtyId = await waitForActivePanePtyId(page)
    await assertTerminalCwd(page, repoPath, 'ORCA_PRIMARY_CWD_BEFORE_RESTART')

    await restart.close(app)
    app = null
    const relaunched = await restart.launch()
    app = relaunched.app
    await waitForSessionReady(relaunched.page)
    await expect
      .poll(() => primaryIdentity(relaunched.page, projectId!))
      .toEqual(expectedPrimaryIdentity)
    await assertTerminalCwd(relaunched.page, repoPath, 'ORCA_PRIMARY_CWD_RESTART')
    const restoredSession = await readActiveSession(relaunched.page)
    expect(restoredSession).toEqual(expectedSession)
    expect(await waitForActivePanePtyId(relaunched.page)).toBe(expectedPtyId)
    await assertSinglePrimaryBadge(relaunched.page)

    await restart.close(app)
    app = null
    const dataFile = path.join(restart.userDataDir, 'orca-data.json')
    const persisted = JSON.parse(readFileSync(dataFile, 'utf8')) as {
      projects?: {
        id?: string
        primaryWorkspace?: { instanceId?: string }
      }[]
      workspaceSession?: Record<string, unknown>
    }
    const persistedProject = persisted.projects?.find((project) => project.id === projectId)
    if (!persistedProject?.primaryWorkspace || !persisted.workspaceSession) {
      throw new Error('Persisted primary workspace profile is incomplete')
    }
    persistedProject.primaryWorkspace.instanceId = 'missing-primary-instance'
    persisted.workspaceSession = {
      ...persisted.workspaceSession,
      activeRepoId: repoId,
      activeWorkspaceKey: null,
      activeWorktreeId: null,
      activeTabId: null,
      tabsByWorktree: {},
      terminalLayoutsByTabId: {}
    }
    writeFileSync(dataFile, `${JSON.stringify(persisted)}\n`)

    const unavailable = await restart.launch()
    app = unavailable.app
    await waitForSessionReady(unavailable.page)
    await expect
      .poll(() => primaryIdentity(unavailable.page, projectId!))
      .toMatchObject({
        ...expectedPrimaryIdentity,
        instanceId: 'missing-primary-instance'
      })
    expect(await readActiveSession(unavailable.page)).toMatchObject({
      activeRepoId: repoId,
      activeWorkspaceKey: null,
      activeWorktreeId: null,
      activeTabId: null
    })
    expect(
      await unavailable.page.evaluate(() => window.__store!.getState().activeWorktreeId)
    ).toBeNull()
    await unavailable.page.evaluate((id) => {
      const state = window.__store!.getState()
      state.openSettingsTarget({ pane: 'repo', repoId: id })
      state.openSettingsPage()
    }, repoId)
    await expect(
      unavailable.page
        .locator(`[data-settings-section="repo-${repoId}"]`)
        .getByRole('combobox')
        .filter({ hasText: 'Saved workspace unavailable' })
    ).toBeVisible()
  } finally {
    if (app) {
      await restart.close(app)
    }
    await restart.dispose()
    rmSync(repoPath, { recursive: true, force: true })
  }
})
