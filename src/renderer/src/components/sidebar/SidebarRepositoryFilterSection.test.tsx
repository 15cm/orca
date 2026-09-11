// @vitest-environment happy-dom

/**
 * The Projects filter lives in a Radix submenu, which breaks two things that
 * work fine in a flat menu: React's `autoFocus` loses a race with the root
 * menu's trapped focus scope, and search state outlives a panel close. Both are
 * invisible to typecheck, so pin them here.
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  state: {} as Record<string, unknown>
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) => selector(mocks.state)
}))

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import SidebarRepositoryFilterSection from './SidebarRepositoryFilterSection'

const REPOS = [
  { id: 'r1', displayName: 'alpha', path: '/tmp/alpha' },
  { id: 'r2', displayName: 'beta', path: '/tmp/beta' },
  { id: 'r3', displayName: 'gamma', path: '/tmp/gamma' }
]

function makeGroup(id: string, name: string, parentGroupId: string | null = null) {
  return {
    id,
    name,
    parentPath: null,
    parentGroupId,
    createdFrom: 'manual',
    tabOrder: 0,
    isCollapsed: false,
    color: null,
    createdAt: 0,
    updatedAt: 0
  }
}

const GROUPS = [makeGroup('g-perc', 'Perc'), makeGroup('g-services', 'Perc (Services)', 'g-perc')]
const GROUPED_REPOS = [
  { ...REPOS[0], projectGroupId: 'g-services' },
  { ...REPOS[1], projectGroupId: 'g-services' },
  REPOS[2]
]

let container: HTMLDivElement
let root: Root
let setFilterRepoIds: ReturnType<typeof vi.fn>
let setFilterGroupIds: ReturnType<typeof vi.fn>

function setState(overrides: Record<string, unknown> = {}): void {
  setFilterRepoIds = vi.fn()
  setFilterGroupIds = vi.fn()
  mocks.state = {
    repos: REPOS,
    projectGroups: [],
    filterRepoIds: [],
    filterGroupIds: [],
    setFilterRepoIds,
    setFilterGroupIds,
    ...overrides
  }
}

function render(): void {
  act(() => {
    root.render(
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger>Options</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Sort by</DropdownMenuItem>
          <SidebarRepositoryFilterSection />
        </DropdownMenuContent>
      </DropdownMenu>
    )
  })
}

/** Radix's trigger opens on pointer, the real path users take with a mouse. */
function openSubmenu(): void {
  const trigger = document.querySelector<HTMLElement>('[data-slot="dropdown-menu-sub-trigger"]')
  if (!trigger) {
    throw new Error('sub-trigger not rendered')
  }
  act(() => {
    trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }))
    trigger.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }))
    trigger.click()
  })
}

function closeSubmenu(): void {
  const content = document.querySelector<HTMLElement>('[data-slot="dropdown-menu-sub-content"]')
  if (!content) {
    throw new Error('sub-content not rendered')
  }
  act(() => {
    content.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true })
    )
  })
}

function searchInput(): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>('[data-slot="command-input"]')
}

/** The focus fix lands in a rAF, so let one frame plus a macrotask elapse. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))
  })
}

/** Types into whatever currently holds focus, so routing is part of the assertion. */
function typeIntoFocused(value: string): void {
  const input = document.activeElement
  if (!(input instanceof HTMLInputElement)) {
    throw new Error(`focus is on ${document.activeElement?.nodeName ?? 'nothing'}, not an input`)
  }
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  // Radix probes pointer capture and scrolling that happy-dom does not model.
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.setPointerCapture ??= () => {}
  Element.prototype.releasePointerCapture ??= () => {}
  Element.prototype.scrollIntoView ??= () => {}
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver
  setState()
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

describe('SidebarRepositoryFilterSection', () => {
  it('focuses the search input when the submenu opens', async () => {
    render()
    openSubmenu()
    await settle()

    expect(searchInput()).not.toBeNull()
    expect(document.activeElement).toBe(searchInput())
  })

  it('routes typing into the search box rather than menu typeahead', async () => {
    render()
    openSubmenu()
    await settle()
    typeIntoFocused('alp')

    expect(searchInput()?.value).toBe('alp')
  })

  it('resets the query when the panel is reopened', async () => {
    render()
    openSubmenu()
    await settle()
    typeIntoFocused('alp')
    expect(searchInput()?.value).toBe('alp')

    closeSubmenu()
    expect(searchInput()).toBeNull()

    openSubmenu()
    await settle()
    expect(searchInput()?.value).toBe('')
  })

  it('keeps ArrowLeft in the text field while the caret can still move', async () => {
    render()
    openSubmenu()
    await settle()
    typeIntoFocused('alp')

    const input = searchInput()
    input?.setSelectionRange(3, 3)
    act(() => {
      input?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true })
      )
    })

    expect(searchInput()).not.toBeNull()
  })

  it('lets ArrowLeft close the panel once the caret is at the start', async () => {
    render()
    openSubmenu()
    await settle()

    const input = searchInput()
    input?.setSelectionRange(0, 0)
    act(() => {
      input?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true })
      )
    })

    expect(searchInput()).toBeNull()
  })

  it('hides itself when only one project exists', () => {
    setState({ repos: [REPOS[0]] })
    render()

    expect(document.querySelector('[data-slot="dropdown-menu-sub-trigger"]')).toBeNull()
  })
})

function subTrigger(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-slot="dropdown-menu-sub-trigger"]')
}

function commandValues(prefix: 'group:' | 'repo:'): string[] {
  return [...document.querySelectorAll<HTMLElement>(`[data-slot="command-item"]`)]
    .map((item) => item.getAttribute('data-value') ?? '')
    .filter((value) => value.startsWith(prefix))
}

describe('SidebarRepositoryFilterSection project groups', () => {
  it('keeps the flat project list when no groups exist', async () => {
    render()
    openSubmenu()
    await settle()

    expect(document.querySelectorAll('[cmdk-group-heading]')).toHaveLength(0)
    expect(commandValues('repo:')).toEqual(['repo:r1', 'repo:r2', 'repo:r3'])
  })

  it('lists groups in their own section, indented by depth, above projects', async () => {
    setState({ repos: GROUPED_REPOS, projectGroups: GROUPS })
    render()
    openSubmenu()
    await settle()

    const headings = [...document.querySelectorAll('[cmdk-group-heading]')].map(
      (heading) => heading.textContent
    )
    expect(headings).toEqual(['Groups', 'Projects'])
    expect(commandValues('group:')).toEqual(['group:g-perc', 'group:g-services'])
    const indents = [...document.querySelectorAll<HTMLElement>('[data-value^="group:"]')].map(
      (item) => item.style.paddingLeft
    )
    expect(indents).toEqual(['8px', '18px'])
    expect(commandValues('repo:')).toEqual(['repo:r1', 'repo:r2', 'repo:r3'])
  })

  it('selects a group as a whole without touching explicit project picks', async () => {
    setState({ repos: GROUPED_REPOS, projectGroups: GROUPS })
    render()
    openSubmenu()
    await settle()

    const item = document.querySelector<HTMLElement>('[data-value="group:g-services"]')
    act(() => item?.click())

    expect(setFilterGroupIds).toHaveBeenCalledWith(['g-services'])
    expect(setFilterRepoIds).not.toHaveBeenCalled()
  })

  it('shows a selected group as one chip and hides its members from the picker', async () => {
    setState({ repos: GROUPED_REPOS, projectGroups: GROUPS, filterGroupIds: ['g-services'] })
    render()
    openSubmenu()
    await settle()

    const chips = document.querySelectorAll('[data-slot="badge"]')
    expect(chips).toHaveLength(1)
    expect(chips[0]?.textContent).toContain('Perc (Services)')
    expect(commandValues('repo:')).toEqual(['repo:r3'])
    expect(commandValues('group:')).toEqual(['group:g-perc'])

    const remove = document.querySelector<HTMLElement>(
      '[aria-label="Remove Perc (Services) filter"]'
    )
    act(() => remove?.click())
    expect(setFilterGroupIds).toHaveBeenCalledWith([])
  })

  it('hides subgroups of a selected group but keeps its ancestors selectable', async () => {
    setState({ repos: GROUPED_REPOS, projectGroups: GROUPS, filterGroupIds: ['g-perc'] })
    render()
    openSubmenu()
    await settle()

    expect(commandValues('group:')).toEqual([])
    expect(commandValues('repo:')).toEqual(['repo:r3'])
  })

  it('names a lone selected group in the trigger row and counts admitted projects', async () => {
    setState({ repos: GROUPED_REPOS, projectGroups: GROUPS, filterGroupIds: ['g-services'] })
    render()

    expect(subTrigger()?.textContent).toContain('Perc (Services)')

    openSubmenu()
    await settle()
    const header = document.querySelector('[data-slot="dropdown-menu-sub-content"] span')
    expect(header?.textContent).toContain('· 2')
  })

  it('reads a mixed selection as the projects it admits', () => {
    setState({
      repos: GROUPED_REPOS,
      projectGroups: GROUPS,
      filterGroupIds: ['g-services'],
      filterRepoIds: ['r3']
    })
    render()

    expect(subTrigger()?.textContent).toContain('3 projects')
  })

  it('clears both halves of the filter from the header button', async () => {
    setState({
      repos: GROUPED_REPOS,
      projectGroups: GROUPS,
      filterGroupIds: ['g-services'],
      filterRepoIds: ['r3']
    })
    render()
    openSubmenu()
    await settle()

    const clear = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent === 'Clear'
    )
    act(() => clear?.click())

    expect(setFilterRepoIds).toHaveBeenCalledWith([])
    expect(setFilterGroupIds).toHaveBeenCalledWith([])
  })
})
