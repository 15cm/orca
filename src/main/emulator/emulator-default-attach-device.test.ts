import { describe, expect, it } from 'vitest'
import { resolveDefaultAttachDevice } from './emulator-default-attach-device'
import type { EmulatorBridge } from './emulator-bridge'
import type { SimulatorDevice } from './simctl-simulator-devices'
import type { EmulatorDevice } from './backends/emulator-backend'

const simulators: SimulatorDevice[] = [
  {
    name: 'iPhone A',
    udid: 'device-a',
    state: 'Booted',
    runtime: 'iOS-18',
    isAvailable: true
  },
  {
    name: 'iPhone B',
    udid: 'device-b',
    state: 'Shutdown',
    runtime: 'iOS-18',
    isAvailable: true
  }
]

const androidDevices: EmulatorDevice[] = [
  {
    backend: 'android',
    id: 'emulator-5554',
    name: 'Pixel',
    state: 'booted',
    isAvailable: true
  },
  {
    backend: 'android',
    id: 'emulator-5556',
    name: 'Pixel 2',
    state: 'shutdown',
    isAvailable: true
  }
]

function fakeBridge(
  overrides: { simulators?: SimulatorDevice[]; all?: EmulatorDevice[] } = {}
): EmulatorBridge {
  return {
    listSimulators: async () => overrides.simulators ?? simulators,
    listAllDevices: async () => overrides.all ?? []
  } as unknown as EmulatorBridge
}

describe('resolveDefaultAttachDevice', () => {
  it('picks the booted simulator when nothing is claimed', async () => {
    expect(await resolveDefaultAttachDevice(fakeBridge())).toBe('device-a')
  })

  it('skips a simulator another worktree is already streaming', async () => {
    const device = await resolveDefaultAttachDevice(fakeBridge(), {
      claimedDeviceIds: new Set(['device-a'])
    })
    expect(device).toBe('device-b')
  })

  it('honors the configured default when it is free', async () => {
    const device = await resolveDefaultAttachDevice(fakeBridge(), {
      preferredDeviceId: 'device-b',
      claimedDeviceIds: new Set(['device-a'])
    })
    expect(device).toBe('device-b')
  })

  it('ignores the configured default once another worktree holds it', async () => {
    const device = await resolveDefaultAttachDevice(fakeBridge(), {
      preferredDeviceId: 'device-a',
      claimedDeviceIds: new Set(['device-a'])
    })
    expect(device).toBe('device-b')
  })

  it('falls back to a shared device when every device is claimed', async () => {
    const device = await resolveDefaultAttachDevice(fakeBridge(), {
      claimedDeviceIds: new Set(['device-a', 'device-b'])
    })
    expect(device).toBe('device-a')
  })

  it('skips claimed devices on backends without simulators', async () => {
    const bridge = fakeBridge({ simulators: [], all: androidDevices })
    expect(await resolveDefaultAttachDevice(bridge)).toBe('emulator-5554')
    expect(
      await resolveDefaultAttachDevice(bridge, {
        claimedDeviceIds: new Set(['emulator-5554'])
      })
    ).toBe('emulator-5556')
  })
})
