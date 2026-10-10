import type { Project } from '../../shared/project-types'

const listeners = new Set<(project: Project) => void>()

export function subscribeProjectPrimaryAuthorityChanges(
  listener: (project: Project) => void
): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function notifyProjectPrimaryAuthorityChanged(project: Project): void {
  for (const listener of listeners) {
    listener(project)
  }
}
