import { beforeEach, describe, expect, it, vi } from 'vitest'
import { recoverTerminalManually, terminalRecoveryFoundNothing } from './terminal-manual-recovery'
import type { PaneManager } from '@/lib/pane-manager/pane-manager'
import type { PtyTransport } from './pty-transport'

const recoverWake = vi.fn()
const focusPane = vi.fn()
const declareVisible = vi.fn()
const setVisibilityClaim = vi.fn()
const forceHeal = vi.fn(async () => ({ healed: false }))
const restoreFits = vi.fn(async (_ids: string[], _settings: unknown) => true)
const driverByPty = new Map<string, { kind: string }>()

vi.mock('./terminal-visibility-resume', () => ({
  recoverVisibleTerminalWindowWake: (args: unknown) => recoverWake(args)
}))
vi.mock('./pane-helpers', () => ({
  focusActivePane: (manager: unknown, options?: unknown) => focusPane(manager, options)
}))
vi.mock('./pty-renderer-delivery-claims', () => ({
  declareRendererPtyDeliveryVisible: (id: string) => declareVisible(id),
  setRendererPtyVisibilityClaim: (owner: unknown, id: string, visible: boolean) =>
    setVisibilityClaim(owner, id, visible)
}))
vi.mock('./terminal-delivery-watchdog', () => ({
  forceTerminalDeliveryHeal: () => forceHeal()
}))
vi.mock('./terminal-fit-restore', () => ({
  restoreTerminalFitsToDesktop: (ids: string[], settings: unknown) => restoreFits(ids, settings)
}))
vi.mock('@/lib/pane-manager/mobile-driver-state', () => ({
  getDriverForPty: (id: string) => driverByPty.get(id) ?? { kind: 'idle' }
}))

function makeTransport(ptyId: string | null, connected = true): PtyTransport {
  return {
    getPtyId: () => ptyId,
    isConnected: () => connected,
    resize: vi.fn(() => true)
  } as unknown as PtyTransport
}

function makeManager(panes: { id: number; cols: number; rows: number }[]): PaneManager {
  return {
    getPanes: () =>
      panes.map((pane) => ({ id: pane.id, terminal: { cols: pane.cols, rows: pane.rows } })),
    getActivePane: () => null
  } as unknown as PaneManager
}

describe('recoverTerminalManually', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    driverByPty.clear()
    forceHeal.mockResolvedValue({ healed: false })
  })

  it('repaints, force-focuses and re-declares visibility for every local pty', async () => {
    const transport = makeTransport('pty-1')
    const report = await recoverTerminalManually({
      manager: makeManager([{ id: 1, cols: 80, rows: 24 }]),
      isActive: true,
      paneTransports: new Map([[1, transport]]),
      settings: undefined
    })

    expect(recoverWake).toHaveBeenCalledWith(expect.objectContaining({ clearGlyphAtlases: true }))
    // Why force: the user asked for this explicitly, so the editable-focus guard must not apply.
    expect(focusPane).toHaveBeenCalledWith(expect.anything(), { force: true })
    expect(setVisibilityClaim).toHaveBeenCalledWith(transport, 'pty-1', true)
    expect(declareVisible).toHaveBeenCalledWith('pty-1')
    expect(report.revisiblePtyCount).toBe(1)
    expect(report.resizedPaneCount).toBe(1)
    expect(report.failedSteps).toEqual([])
  })

  it('skips remote ptys, which ride a relay outside main visibility registry', async () => {
    const report = await recoverTerminalManually({
      manager: makeManager([]),
      isActive: true,
      paneTransports: new Map([[1, makeTransport('remote:pty-9')]]),
      settings: undefined
    })

    expect(declareVisible).not.toHaveBeenCalled()
    expect(report.revisiblePtyCount).toBe(0)
  })

  it('does not re-assert size on a disconnected transport', async () => {
    const transport = makeTransport('pty-1', false)
    const report = await recoverTerminalManually({
      manager: makeManager([{ id: 1, cols: 80, rows: 24 }]),
      isActive: true,
      paneTransports: new Map([[1, transport]]),
      settings: undefined
    })

    expect(transport.resize).not.toHaveBeenCalled()
    expect(report.resizedPaneCount).toBe(0)
  })

  it('takes back a pty still held by a mobile presence lock', async () => {
    driverByPty.set('pty-1', { kind: 'mobile' })
    const report = await recoverTerminalManually({
      manager: makeManager([]),
      isActive: true,
      paneTransports: new Map([[1, makeTransport('pty-1')]]),
      settings: undefined
    })

    expect(restoreFits).toHaveBeenCalledWith(['pty-1'], undefined)
    expect(report.mobileLockedPtyCount).toBe(1)
  })

  it('keeps running after a step throws — a rescue never aborts halfway', async () => {
    recoverWake.mockImplementationOnce(() => {
      throw new Error('webgl gone')
    })
    const report = await recoverTerminalManually({
      manager: makeManager([{ id: 1, cols: 80, rows: 24 }]),
      isActive: true,
      paneTransports: new Map([[1, makeTransport('pty-1')]]),
      settings: undefined
    })

    expect(report.failedSteps).toEqual(['render'])
    expect(focusPane).toHaveBeenCalled()
    expect(declareVisible).toHaveBeenCalledWith('pty-1')
    expect(report.resizedPaneCount).toBe(1)
  })

  it('reports a healthy terminal as nothing repaired', async () => {
    const report = await recoverTerminalManually({
      manager: makeManager([]),
      isActive: true,
      paneTransports: new Map(),
      settings: undefined
    })

    expect(terminalRecoveryFoundNothing(report)).toBe(true)
  })

  it('counts a delivery heal as a real repair', async () => {
    forceHeal.mockResolvedValue({ healed: true })
    const report = await recoverTerminalManually({
      manager: makeManager([]),
      isActive: true,
      paneTransports: new Map(),
      settings: undefined
    })

    expect(report.deliveryHealed).toBe(true)
    expect(terminalRecoveryFoundNothing(report)).toBe(false)
  })
})
