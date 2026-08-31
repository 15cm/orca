import type {
  SharedTabCatalogChange,
  SharedTabCatalogEntry,
  SharedTabMutation
} from '../../shared/shared-tab-catalog-types'

export function isCatalogChange(
  value: unknown,
  mutationValidator: (value: unknown) => boolean,
  entryValidator: (value: unknown) => boolean
): value is SharedTabCatalogChange {
  if (!value || typeof value !== 'object') {
    return false
  }
  const change = value as Record<string, unknown>
  let serializedSize = 0
  try {
    serializedSize = JSON.stringify(value).length
  } catch {
    return false
  }
  return (
    Number.isSafeInteger(change.revision) &&
    (change.revision as number) >= 0 &&
    mutationValidator(change.mutation) &&
    (change.tab === null || entryValidator(change.tab)) &&
    serializedSize <= 512_000
  )
}

export function isMutationContentCompatible(
  mutation: SharedTabMutation,
  current: SharedTabCatalogEntry | null
): boolean {
  if (!current) {
    return true
  }
  if (mutation.kind === 'bind-terminal') {
    return current.contentType === 'terminal'
  }
  if (mutation.kind !== 'patch' || mutation.backingState === undefined) {
    return true
  }
  const expected =
    current.contentType === 'terminal'
      ? 'terminal'
      : current.contentType === 'browser'
        ? 'browser'
        : current.contentType === 'simulator'
          ? 'simulator'
          : 'editor'
  return mutation.backingState.kind === expected
}
