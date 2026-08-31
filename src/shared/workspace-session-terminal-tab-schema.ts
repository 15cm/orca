import { z } from 'zod'
import { isValidTerminalTabId } from './terminal-tab-id'
import { isTuiAgent } from './tui-agent-config'
import type { TuiAgent } from './tui-agent'
import { persistedCatalogIdentitySchema } from './workspace-session-catalog-schema'

export const terminalTabIdSchema = z
  .string()
  .min(1)
  .refine(isValidTerminalTabId, 'terminal tab id must not contain ":"')

export const terminalTabSchema = z.object({
  id: terminalTabIdSchema,
  catalogTabId: persistedCatalogIdentitySchema.optional().catch(undefined),
  ptyId: z.string().nullable(),
  worktreeId: z.string(),
  title: z.string(),
  defaultTitle: z.string().optional(),
  generatedTitle: z.string().nullable().optional(),
  aiVaultTitle: z
    .object({ agent: z.enum(['claude', 'codex']), sessionId: z.string(), title: z.string() })
    .nullable()
    .optional()
    .catch(undefined),
  quickCommandLabel: z.string().nullable().optional(),
  customTitle: z.string().nullable(),
  color: z.string().nullable(),
  isPinned: z.boolean().optional(),
  sortOrder: z.number(),
  createdAt: z.number(),
  generation: z.number().optional(),
  startupCwd: z.string().min(1).optional(),
  launchAgent: z
    .custom<TuiAgent>((value) => isTuiAgent(value))
    .optional()
    .catch(undefined)
})
