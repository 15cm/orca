import { describe, expect, it, vi } from 'vitest'
import { spawnMock } from './pty-ipc-mock-registry'
import { setupPtyIpcSuite } from './pty-ipc-test-harness'
import { registerPtyHandlers } from './pty'

vi.mock('electron', () => import('./pty-ipc-mock-registry').then((m) => m.electronModuleMock()))
vi.mock('fs', () => import('./pty-ipc-mock-registry').then((m) => m.fsModuleMock()))
vi.mock('node-pty', () => import('./pty-ipc-mock-registry').then((m) => m.nodePtyModuleMock()))
vi.mock('node:child_process', async (importOriginal) =>
  (await import('./pty-ipc-mock-registry')).childProcessModuleMock(await importOriginal())
)
vi.mock('../opencode/hook-service', () =>
  import('./pty-ipc-mock-registry').then((m) => m.openCodeHookServiceModuleMock())
)
vi.mock('../mimo/hook-service', () =>
  import('./pty-ipc-mock-registry').then((m) => m.mimoHookServiceModuleMock())
)
vi.mock('../agent-hooks/server', () =>
  import('./pty-ipc-mock-registry').then((m) => m.agentHookServerModuleMock())
)
vi.mock('../pi/titlebar-extension-service', () =>
  import('./pty-ipc-mock-registry').then((m) => m.piTitlebarExtensionModuleMock())
)
vi.mock('../pwsh', () => import('./pty-ipc-mock-registry').then((m) => m.pwshModuleMock()))
vi.mock('../wsl', async (importOriginal) =>
  (await import('./pty-ipc-mock-registry')).wslModuleMock(await importOriginal())
)
vi.mock('../telemetry/client', () =>
  import('./pty-ipc-mock-registry').then((m) => m.telemetryClientModuleMock())
)
vi.mock('../telemetry/classify-error', () =>
  import('./pty-ipc-mock-registry').then((m) => m.classifyErrorModuleMock())
)
vi.mock('../cli/linux-terminal-orca-cli-shim', () =>
  import('./pty-ipc-mock-registry').then((m) => m.linuxCliShimModuleMock())
)
vi.mock('../memory/pty-registry', () =>
  import('./pty-ipc-mock-registry').then((m) => m.ptyRegistryModuleMock())
)
vi.mock('../agent-hooks/migration-unsupported-pty-state', () =>
  import('./pty-ipc-mock-registry').then((m) => m.migrationUnsupportedPtyModuleMock())
)
vi.mock('../codex/codex-pane-account-registry', () =>
  import('./pty-ipc-mock-registry').then((m) => m.codexPaneAccountRegistryModuleMock())
)
vi.mock('../codex/codex-state-db-backfill-recovery', () =>
  import('./pty-ipc-mock-registry').then((m) => m.codexBackfillRecoveryModuleMock())
)

describe('pty delivery after the registering window closes', () => {
  const { handlers, mainWindow, trackTestMainWindow, createMockProc } = setupPtyIpcSuite()

  function makeSecondWindow(): {
    window: {
      id: number
      on: ReturnType<typeof vi.fn>
      once: ReturnType<typeof vi.fn>
      removeListener: ReturnType<typeof vi.fn>
      isDestroyed: () => boolean
      isFocused: () => boolean
      isVisible: () => boolean
      isMinimized: () => boolean
      webContents: {
        on: ReturnType<typeof vi.fn>
        send: ReturnType<typeof vi.fn>
        removeListener: ReturnType<typeof vi.fn>
        isDestroyed: () => boolean
      }
    }
    destroy: () => void
  } {
    let destroyed = false
    return {
      window: {
        id: 2,
        on: vi.fn(),
        once: vi.fn(),
        removeListener: vi.fn(),
        isDestroyed: () => destroyed,
        isFocused: () => false,
        isVisible: () => true,
        isMinimized: () => false,
        webContents: {
          on: vi.fn(),
          send: vi.fn(),
          removeListener: vi.fn(),
          isDestroyed: () => destroyed
        }
      },
      destroy: () => {
        destroyed = true
      }
    }
  }

  it('keeps delivering to a surviving window after the last-registered one is destroyed', async () => {
    vi.useFakeTimers()
    const mockProc = createMockProc()
    spawnMock.mockReturnValue(mockProc.proc)
    const second = makeSecondWindow()

    try {
      registerPtyHandlers(mainWindow as never)
      const spawnResult = (await handlers.get('pty:spawn')!(null, {
        cols: 80,
        rows: 24,
        cwd: '/tmp'
      })) as { id: string }

      // A second window registers and then closes; the PTY still belongs to the first one.
      trackTestMainWindow(second.window)
      registerPtyHandlers(second.window as never)
      second.destroy()
      mainWindow.webContents.send.mockClear()

      mockProc.emitData('output after the second window closed')
      vi.advanceTimersByTime(8)

      expect(mainWindow.webContents.send).toHaveBeenCalledWith('pty:data', {
        id: spawnResult.id,
        data: 'output after the second window closed'
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('delivers nothing for a headless session even while a renderer window is registered', async () => {
    vi.useFakeTimers()
    const mockProc = createMockProc()
    spawnMock.mockReturnValue(mockProc.proc)
    // Why this shape: `orca serve` encodes "no renderer" as a permanently destroyed fake window.
    const headlessWindow = {
      id: 3,
      on: vi.fn(),
      once: vi.fn(),
      removeListener: vi.fn(),
      isDestroyed: () => true,
      webContents: {
        on: vi.fn(),
        send: vi.fn(),
        removeListener: vi.fn(),
        isDestroyed: () => true
      }
    }

    try {
      registerPtyHandlers(
        headlessWindow as never,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { headless: true }
      )
      await handlers.get('pty:spawn')!(null, { cols: 80, rows: 24, cwd: '/tmp' })
      mainWindow.webContents.send.mockClear()

      mockProc.emitData('serve output nobody is watching')
      vi.advanceTimersByTime(8)

      expect(mainWindow.webContents.send).not.toHaveBeenCalled()
      expect(headlessWindow.webContents.send).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
