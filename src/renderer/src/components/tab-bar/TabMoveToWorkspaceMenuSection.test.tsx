/**
 * @vitest-environment happy-dom
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Tab } from '../../../../shared/tab-types'
import type { Worktree } from '../../../../shared/worktree/types'
import { setVisibleWorktreeShortcutTargets } from '../sidebar/rendered-sidebar-worktree-publication'
import { TabMoveToWorkspaceMenuSection } from './TabMoveToWorkspaceMenuSection'

const storeMock = vi.hoisted(() => ({ state: {} as Record<string, unknown> }))
const moveTabToWorkspace = vi.hoisted(() => vi.fn())
const runtimeEnvironmentIdByWorktree = vi.hoisted(() => new Map<string, string | null>())

vi.mock('../../store', () => ({
  useAppStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) => selector(storeMock.state),
    { getState: () => storeMock.state }
  )
}))

vi.mock('./tab-move-to-workspace', () => ({ moveTabToWorkspace }))

vi.mock('@/lib/worktree-runtime-owner', () => ({
  getRuntimeEnvironmentIdForWorktree: (_state: unknown, worktreeId: string) =>
    runtimeEnvironmentIdByWorktree.get(worktreeId) ?? null
}))

vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))

vi.mock('lucide-react', async () => (await import('./lucide-icon-stub-fixture')).stubEveryIcon())

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenuItem: ({ children, onSelect }: { children?: ReactNode; onSelect?: () => void }) => (
    <button type="button" onClick={() => onSelect?.()}>
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuSub: ({ children }: { children?: ReactNode }) => children,
  DropdownMenuSubContent: ({ children }: { children?: ReactNode }) => children,
  DropdownMenuSubTrigger: ({ children }: { children?: ReactNode }) => (
    <button type="button">{children}</button>
  )
}))

const TASKS = 'folder:tasks'
const CLOSED = 'folder:closed'
const TERMINALS = 'folder:terminals'
const REMOTE = 'folder:remote'

function worktree(id: string, displayName: string, hostId?: Worktree['hostId']): Worktree {
  return {
    id,
    repoId: 'folder-workspace:perc',
    path: '/tmp/perc',
    head: '',
    branch: '',
    isBare: false,
    isMainWorktree: false,
    displayName,
    comment: '',
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    linkedGitLabMR: null,
    linkedGitLabIssue: null,
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 0,
    ...(hostId ? { hostId } : {})
  }
}

function tab(overrides: Partial<Tab> = {}): Tab {
  return {
    id: 'agent',
    entityId: 'agent',
    groupId: 'tasks-group',
    worktreeId: TASKS,
    contentType: 'terminal',
    label: 'claude',
    customLabel: null,
    color: null,
    sortOrder: 0,
    createdAt: 0,
    ...overrides
  }
}

const mounted: { container: HTMLDivElement; root: Root }[] = []

function render(unifiedTabId = 'agent'): HTMLDivElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(<TabMoveToWorkspaceMenuSection unifiedTabId={unifiedTabId} />)
  })
  mounted.push({ container, root })
  return container
}

function labels(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('button')).map(
    (button) => button.textContent?.trim() ?? ''
  )
}

beforeEach(() => {
  moveTabToWorkspace.mockReset()
  runtimeEnvironmentIdByWorktree.clear()
  // Closed renders above Terminals in the sidebar; the submenu must match.
  setVisibleWorktreeShortcutTargets([
    { id: TASKS, executionHostId: 'local' },
    { id: CLOSED, executionHostId: 'local' },
    { id: TERMINALS, executionHostId: 'local' },
    { id: REMOTE, executionHostId: 'ssh:box' }
  ])
  storeMock.state = {
    unifiedTabsByWorktree: { [TASKS]: [tab()] },
    worktreesByRepo: {
      'folder-workspace:perc': [
        worktree(TASKS, 'Tasks', 'local'),
        worktree(CLOSED, 'Closed', 'local'),
        worktree(TERMINALS, 'Terminals', 'local'),
        worktree(REMOTE, 'Remote', 'ssh:box')
      ]
    }
  }
})

afterEach(() => {
  setVisibleWorktreeShortcutTargets(null)
  for (const entry of mounted.splice(0)) {
    act(() => entry.root.unmount())
    entry.container.remove()
  }
})

describe('TabMoveToWorkspaceMenuSection', () => {
  it('lists same-host destinations in rendered sidebar order', () => {
    expect(labels(render())).toEqual(['Move to Workspace', 'Closed', 'Terminals'])
  })

  it('omits the workspace the tab already lives in', () => {
    expect(labels(render())).not.toContain('Tasks')
  })

  it('omits workspaces on another execution host', () => {
    expect(labels(render())).not.toContain('Remote')
  })

  it('omits workspaces whose tab model is owned by a remote runtime host', () => {
    runtimeEnvironmentIdByWorktree.set(TERMINALS, 'runtime-1')

    expect(labels(render())).toEqual(['Move to Workspace', 'Closed'])
  })

  it('treats workspaces with no explicit host as local, like the sidebar does', () => {
    setVisibleWorktreeShortcutTargets([{ id: TASKS }, { id: CLOSED }])
    storeMock.state = {
      ...storeMock.state,
      worktreesByRepo: {
        'folder-workspace:perc': [worktree(TASKS, 'Tasks'), worktree(CLOSED, 'Closed')]
      }
    }

    expect(labels(render())).toEqual(['Move to Workspace', 'Closed'])
  })

  it('renders nothing when the tab cannot leave its workspace', () => {
    storeMock.state = {
      ...storeMock.state,
      unifiedTabsByWorktree: { [TASKS]: [tab({ contentType: 'diff' })] }
    }

    expect(render().querySelector('button')).toBeNull()
  })

  it('renders nothing when no other workspace qualifies', () => {
    setVisibleWorktreeShortcutTargets([{ id: TASKS, executionHostId: 'local' }])

    expect(render().querySelector('button')).toBeNull()
  })

  it('moves the tab to the picked workspace', () => {
    const container = render()

    const closed = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Closed'
    )
    act(() => {
      closed?.click()
    })

    expect(moveTabToWorkspace).toHaveBeenCalledWith({
      unifiedTabId: 'agent',
      targetWorktreeId: CLOSED,
      targetLabel: 'Closed'
    })
  })
})
