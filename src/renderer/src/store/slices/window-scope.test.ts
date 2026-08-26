// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createStore, type StoreApi } from 'zustand/vanilla'
import type { AppState } from '../types'
import { createWindowScopeSlice } from './window-scope'

const PERC = { type: 'project-group' as const, projectGroupId: 'perc' }

function makeStore() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return createStore<any>()((...args: any[]) => ({
    projectGroups: [{ id: 'perc', name: 'Perc' }],
    filterRepoIds: ['picked'],
    filterGroupIds: [],
    ...createWindowScopeSlice(...(args as Parameters<typeof createWindowScopeSlice>))
  })) as unknown as StoreApi<AppState>
}

describe('window scope slice', () => {
  const ui = {
    openProjectGroupWindow: vi.fn(async () => ({ status: 'opened' as const })),
    setWindowScope: vi.fn(async () => ({ status: 'released' as const }))
  }
  let previousApi: unknown

  beforeEach(() => {
    ui.openProjectGroupWindow.mockClear()
    ui.setWindowScope.mockClear()
    previousApi = (window as unknown as { api?: unknown }).api
    ;(window as unknown as { api: unknown }).api = { ui }
  })

  afterEach(() => {
    ;(window as unknown as { api?: unknown }).api = previousApi
  })

  it('starts free and not ready, then adopts the snapshot main answers with', () => {
    const store = makeStore()
    expect(store.getState().windowScopeReady).toBe(false)

    store.getState().applyWindowScopeSnapshot({ scope: PERC, scopedWindowsEnabled: true })

    expect(store.getState()).toMatchObject({
      windowScope: PERC,
      windowScopeReady: true,
      scopedWindowsEnabled: true
    })
    // Why: the effective-filter selector caches on scope identity; an equal scope must not churn it.
    const scope = store.getState().windowScope
    store.getState().applyWindowScopeSnapshot({
      scope: { ...PERC },
      scopedWindowsEnabled: true
    })
    expect(store.getState().windowScope).toBe(scope)
  })

  it('replaces the project filter wholesale on a rebind pushed by main', () => {
    const store = makeStore()

    store.getState().applyWindowScopeChange({
      scope: PERC,
      scopedWindowsEnabled: true,
      viewState: { filterRepoIds: [], filterGroupIds: ['perc'] }
    })
    expect(store.getState().filterRepoIds).toEqual([])
    expect(store.getState().filterGroupIds).toEqual(['perc'])

    store.getState().applyWindowScopeChange({
      scope: null,
      scopedWindowsEnabled: true,
      viewState: { filterRepoIds: ['persisted'], filterGroupIds: [] }
    })
    expect(store.getState().windowScope).toBeNull()
    expect(store.getState().filterRepoIds).toEqual(['persisted'])
  })

  it('sends the group name the catalog knows along with open and bind requests', async () => {
    const store = makeStore()

    await store.getState().openProjectGroupWindow('perc')
    await store.getState().bindWindowToProjectGroup('remote-group')
    await store.getState().releaseWindowScope()

    expect(ui.openProjectGroupWindow).toHaveBeenCalledWith({
      projectGroupId: 'perc',
      projectLabel: 'Perc'
    })
    expect(ui.setWindowScope).toHaveBeenNthCalledWith(1, {
      projectGroupId: 'remote-group',
      projectLabel: null
    })
    expect(ui.setWindowScope).toHaveBeenNthCalledWith(2, null)
  })

  it('degrades a failed request to unavailable instead of throwing into the menu', async () => {
    ui.setWindowScope.mockRejectedValueOnce(new Error('ipc down'))
    const store = makeStore()

    await expect(store.getState().bindWindowToProjectGroup('perc')).resolves.toEqual({
      status: 'unavailable'
    })
  })
})
