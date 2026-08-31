import { describe, expect, it } from 'vitest'
import { isFocusedPtyOwnerWindow } from './pty-window-ownership'

describe('PTY owner window eligibility', () => {
  it('rejects missing, destroyed, and unfocused windows', () => {
    expect(isFocusedPtyOwnerWindow(null)).toBe(false)
    expect(isFocusedPtyOwnerWindow({ isDestroyed: () => true, isFocused: () => true })).toBe(false)
    expect(isFocusedPtyOwnerWindow({ isDestroyed: () => false, isFocused: () => false })).toBe(
      false
    )
  })

  it('accepts only a live focused native window', () => {
    expect(isFocusedPtyOwnerWindow({ isDestroyed: () => false, isFocused: () => true })).toBe(true)
  })
})
