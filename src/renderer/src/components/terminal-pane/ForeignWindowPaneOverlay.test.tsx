// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '../../store'
import { ForeignWindowPaneOverlay } from './ForeignWindowPaneOverlay'
import { shouldShowForeignWindowPaneOverlay } from './foreign-window-pane-overlay-visibility'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
  useAppStore.setState(useAppStore.getInitialState(), true)
})

async function render(
  owner: { projectGroupId: string | null },
  onBringHere: () => Promise<void>
): Promise<void> {
  await act(async () => {
    root.render(<ForeignWindowPaneOverlay owner={owner} onBringHere={onBringHere} />)
  })
}

describe('ForeignWindowPaneOverlay', () => {
  it('names the owning project window and offers to bring the terminal here', async () => {
    useAppStore.setState({
      projectGroups: [{ id: 'group-perc', name: 'Perc' } as never]
    })
    const onBringHere = vi.fn(() => Promise.resolve())

    await render({ projectGroupId: 'group-perc' }, onBringHere)

    expect(container.textContent).toContain('Running in the Perc window')
    const button = container.querySelector('button')!
    expect(button.textContent).toBe('Bring here')
    await act(async () => {
      button.click()
    })
    expect(onBringHere).toHaveBeenCalledTimes(1)
  })

  it('degrades to generic copy for a free window or an unresolved group', async () => {
    await render({ projectGroupId: null }, () => Promise.resolve())
    expect(container.textContent).toContain('Running in another window')

    await render({ projectGroupId: 'group-remote' }, () => Promise.resolve())
    expect(container.textContent).toContain('Running in another project window')
  })
})

describe('shouldShowForeignWindowPaneOverlay', () => {
  it('shows only for a foreign owner while scoped windows are on', () => {
    expect(shouldShowForeignWindowPaneOverlay({ projectGroupId: 'g' }, true)).toBe(true)
    expect(shouldShowForeignWindowPaneOverlay({ projectGroupId: null }, true)).toBe(true)
    expect(shouldShowForeignWindowPaneOverlay(null, true)).toBe(false)
    // Why: flag off means one window; a stale entry must not paint a banner nobody can act on.
    expect(shouldShowForeignWindowPaneOverlay({ projectGroupId: 'g' }, false)).toBe(false)
  })
})
