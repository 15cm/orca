// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WindowScopeChangedPayload, WindowScopeSnapshot } from '../../../shared/window-scope'
import { useAppStore } from '../store'
import { useWindowScopeSync } from './use-window-scope-sync'

const initialState = useAppStore.getState()

describe('useWindowScopeSync', () => {
  let resolveSnapshot: (snapshot: WindowScopeSnapshot) => void
  let scopeChanged: (payload: WindowScopeChangedPayload) => void
  const unsubscribe = vi.fn()
  const setWindowScopeLabel = vi.fn()

  beforeEach(() => {
    unsubscribe.mockClear()
    setWindowScopeLabel.mockClear()
    const snapshot = new Promise<WindowScopeSnapshot>((resolve) => {
      resolveSnapshot = resolve
    })
    ;(window as unknown as { api: unknown }).api = {
      ui: {
        getWindowScope: vi.fn(() => snapshot),
        onWindowScopeChanged: vi.fn((listener: typeof scopeChanged) => {
          scopeChanged = listener
          return unsubscribe
        }),
        setWindowScopeLabel
      },
      session: { onWorkspacesReleased: vi.fn(() => vi.fn()) }
    }
    useAppStore.setState({
      projectGroups: [
        {
          id: 'perc',
          name: 'Perc',
          parentPath: null,
          parentGroupId: null,
          createdFrom: 'manual',
          tabOrder: 0,
          isCollapsed: false,
          color: null,
          createdAt: 1,
          updatedAt: 1
        }
      ],
      windowScope: null,
      windowScopeReady: false,
      scopedWindowsEnabled: false,
      filterRepoIds: ['seed'],
      filterGroupIds: []
    })
  })

  afterEach(() => {
    useAppStore.setState(initialState, true)
  })

  it('hydrates launch scope and replays changes received before the snapshot', async () => {
    const { unmount } = renderHook(() => useWindowScopeSync())
    const changed: WindowScopeChangedPayload = {
      scope: { type: 'project-group', projectGroupId: 'perc' },
      scopedWindowsEnabled: true,
      viewState: { filterRepoIds: [], filterGroupIds: ['perc'] }
    }

    act(() => scopeChanged(changed))
    expect(useAppStore.getState().windowScopeReady).toBe(false)

    await act(async () => {
      resolveSnapshot({ scope: null, scopedWindowsEnabled: true })
      await Promise.resolve()
    })

    expect(useAppStore.getState()).toMatchObject({
      windowScope: changed.scope,
      windowScopeReady: true,
      scopedWindowsEnabled: true,
      filterRepoIds: [],
      filterGroupIds: ['perc']
    })
    unmount()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })
})
