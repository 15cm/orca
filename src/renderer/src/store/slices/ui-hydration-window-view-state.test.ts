import { describe, expect, it } from 'vitest'
import { createUIStore, makePersistedUI } from './ui-slice-test-harness'

describe('per-window project filter hydration', () => {
  it('seeds the filter from the persisted profile on startup', () => {
    const store = createUIStore()

    store
      .getState()
      .hydratePersistedUI(
        makePersistedUI({ filterRepoIds: ['seed'], filterGroupIds: ['group-1'] }),
        'startup'
      )

    expect(store.getState().filterRepoIds).toEqual(['seed'])
    expect(store.getState().filterGroupIds).toEqual(['group-1'])
  })

  it('keeps the window own filter when a sync broadcast carries another value', () => {
    const store = createUIStore()
    store.getState().hydratePersistedUI(makePersistedUI({ filterRepoIds: ['seed'] }), 'startup')
    store.getState().setFilterRepoIds(['perc'])
    store.getState().setFilterGroupIds(['perc-group'])

    store
      .getState()
      .hydratePersistedUI(
        makePersistedUI({ filterRepoIds: ['cce'], filterGroupIds: [], uiZoomLevel: 1 }),
        'sync'
      )

    expect(store.getState().filterRepoIds).toEqual(['perc'])
    expect(store.getState().filterGroupIds).toEqual(['perc-group'])
    // Why: profile-owned keys still sync; only the per-window subset is pinned.
    expect(store.getState().uiZoomLevel).toBe(1)
  })

  it('keeps two windows isolated when both receive the same profile broadcast', () => {
    const windowA = createUIStore()
    const windowB = createUIStore()
    const persisted = makePersistedUI({ filterRepoIds: ['seed'] })
    windowA.getState().hydratePersistedUI(persisted, 'startup')
    windowB.getState().hydratePersistedUI(persisted, 'startup')
    windowA.getState().setFilterRepoIds(['perc'])
    windowB.getState().setFilterGroupIds(['cce-group'])

    // Why: window A's debounced writer persisted its filter; main broadcasts the profile to both.
    const broadcast = makePersistedUI({ filterRepoIds: ['perc'], sidebarWidth: 333 })
    windowA.getState().hydratePersistedUI(broadcast, 'sync')
    windowB.getState().hydratePersistedUI(broadcast, 'sync')

    expect(windowA.getState().filterRepoIds).toEqual(['perc'])
    expect(windowA.getState().filterGroupIds).toEqual([])
    expect(windowB.getState().filterRepoIds).toEqual(['seed'])
    expect(windowB.getState().filterGroupIds).toEqual(['cce-group'])
    expect(windowA.getState().sidebarWidth).toBe(333)
    expect(windowB.getState().sidebarWidth).toBe(333)
  })

  it('returns the same state reference when a sync broadcast changes nothing for this window', () => {
    const store = createUIStore()
    const persisted = makePersistedUI({ filterRepoIds: ['seed'] })
    store.getState().hydratePersistedUI(persisted, 'startup')
    const before = store.getState()

    store.getState().hydratePersistedUI({ ...persisted, filterRepoIds: ['other'] }, 'sync')

    expect(store.getState()).toBe(before)
  })
})
