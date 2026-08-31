import { z } from 'zod'
import { salvagedOptional, salvagingArray, salvagingRecord } from './zod-salvage'
import type { SharedTabCatalogPersistedState } from './shared-tab-catalog-types'

// Validation preserves accepted identity bytes; refinement rejects blank values without trimming.
export const persistedCatalogIdentitySchema = z
  .string()
  .min(1)
  .max(512)
  .refine((value) => value.trim().length > 0)

const contentType = z.enum([
  'terminal',
  'editor',
  'diff',
  'conflict-review',
  'check-details',
  'browser',
  'simulator'
])
const metadata = z.object({
  entityId: z.string().min(1).max(4096),
  catalogEntityId: persistedCatalogIdentitySchema.optional().catch(undefined),
  label: z.string().max(4096),
  customLabel: z.string().max(4096).nullable(),
  color: z.string().max(128).nullable(),
  isPinned: z.boolean().optional(),
  isPreview: z.boolean().optional(),
  viewMode: z.enum(['terminal', 'chat']).optional()
})
const backing = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('terminal'),
    ptyIds: salvagingArray(z.string().min(1).max(512)).optional().default([])
  }),
  z.object({
    kind: z.literal('editor'),
    filePath: z.string().max(4096).optional(),
    language: z.string().max(256).optional()
  }),
  z.object({
    kind: z.literal('browser'),
    browserWorkspaceId: z.string().max(4096).optional(),
    catalogEntityId: persistedCatalogIdentitySchema.optional().catch(undefined),
    pages: salvagingArray(z.string().max(4096)).optional(),
    catalogPageIds: salvagingArray(persistedCatalogIdentitySchema).optional()
  }),
  z.object({ kind: z.literal('simulator'), simulatorId: z.string().max(4096).optional() })
])
const entry = z.object({
  tabId: z.string().min(1).max(512),
  catalogTabId: persistedCatalogIdentitySchema.optional().catch(undefined),
  contentType,
  metadata,
  backingState: backing.optional(),
  terminalBinding: z
    .object({ ptyId: z.string().min(1).max(512), incarnationId: z.string().max(128).optional() })
    .nullable()
    .optional()
})
const bootstrap = z.object({
  revision: z.number().int().nonnegative(),
  tabs: salvagingArray(entry),
  tombstones: salvagingArray(z.string().min(1).max(512))
})
export const sharedTabCatalogSchema: z.ZodType<SharedTabCatalogPersistedState> = z.object({
  partitions: salvagingRecord(z.string().max(4096), bootstrap)
})
export const sharedTabCatalogFieldSchema = salvagedOptional(
  'sharedTabCatalog',
  sharedTabCatalogSchema
)
