import type { StateCreator } from 'zustand'
import type { AppState } from '../types'
import type { RepoSlice, ProjectPrimaryWorkspaceResult } from '../repos/repo-state'
import { callRuntimeRpc } from '../../runtime/runtime-rpc-client'
import type { Project } from '../../../../shared/project-types'
import { normalizeProjectRow } from '../../../../shared/project-catalog-row-normalization'
import { mergeProjectCompatibilityProject } from './project-compatibility-core'
import {
  hasSavedPrimaryWorkspace,
  resolveProjectPrimaryWorkspace
} from '../../../../shared/project-primary-workspace'

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function samePrimary(a: Project['primaryWorkspace'], b: Project['primaryWorkspace']): boolean {
  return (
    a?.hostId === b?.hostId &&
    a?.worktreeId === b?.worktreeId &&
    a?.path === b?.path &&
    a?.instanceId === b?.instanceId &&
    a?.peerFingerprint === b?.peerFingerprint &&
    a?.authorityFingerprint === b?.authorityFingerprint
  )
}

function hasStrictPrimaryResponse(project: Project): boolean {
  const primary = project.primaryWorkspace
  return Boolean(
    primary &&
    hasText(project.primaryAuthorityFingerprint) &&
    primary.authorityFingerprint === project.primaryAuthorityFingerprint &&
    resolveProjectPrimaryWorkspace(project, [
      {
        id: primary.worktreeId,
        path: primary.path,
        instanceId: primary.instanceId,
        hostId: primary.hostId,
        peerFingerprint: primary.peerFingerprint
      }
    ])
  )
}

function conflictsWithCurrentAuthority(current: Project, incoming: Project): boolean {
  const currentAuthority =
    current.primaryAuthorityFingerprint !== undefined
      ? current.primaryAuthorityFingerprint
      : current.primaryWorkspace?.authorityFingerprint
  return (
    currentAuthority !== undefined &&
    currentAuthority !== incoming.primaryAuthorityFingerprint
  )
}

export function createProjectPrimaryWorkspaceActions(
  set: Parameters<StateCreator<AppState>>[0],
  get: Parameters<StateCreator<AppState>>[1]
): Pick<RepoSlice, 'setProjectPrimaryWorkspace'> {
  return {
    setProjectPrimaryWorkspace: async (projectId, worktreeSelector, hostId) => {
      try {
        const result = await callRuntimeRpc<{ project: Project }>(
          { kind: 'local' },
          'project.primary.set',
          { projectId, worktree: worktreeSelector, ...(hostId ? { hostId } : {}) }
        )
        if (
          !result?.project ||
          result.project.id !== projectId ||
          typeof result.project.displayName !== 'string' ||
          typeof result.project.badgeColor !== 'string' ||
          !Array.isArray(result.project.sourceRepoIds) ||
          typeof result.project.createdAt !== 'number' ||
          typeof result.project.updatedAt !== 'number' ||
          !Number.isSafeInteger(result.project.primaryWorkspaceRevision) ||
          result.project.primaryWorkspaceRevision! < 0 ||
          !hasStrictPrimaryResponse(result.project)
        ) {
          return { error: new Error('Invalid project.primary.set response') }
        }
        const project = normalizeProjectRow(result.project)
        const beforeMerge = get().projects.find((candidate) => candidate.id === projectId)
        if (beforeMerge && conflictsWithCurrentAuthority(beforeMerge, project)) {
          return { error: new Error('Primary workspace authority changed') }
        }
        if (
          beforeMerge &&
          (project.primaryWorkspaceRevision! < (beforeMerge.primaryWorkspaceRevision ?? -1) ||
            (project.primaryWorkspaceRevision === beforeMerge.primaryWorkspaceRevision &&
              hasSavedPrimaryWorkspace(beforeMerge) &&
              !samePrimary(beforeMerge.primaryWorkspace, project.primaryWorkspace)))
        ) {
          return { error: new Error('Stale primary workspace response') }
        }
        let mergeRejected = false
        set((state) => {
          const current = state.projects.find((candidate) => candidate.id === projectId)
          if (current && conflictsWithCurrentAuthority(current, project)) {
            mergeRejected = true
            return state
          }
          const currentRevision = current?.primaryWorkspaceRevision ?? -1
          const revision = project.primaryWorkspaceRevision!
          if (
            revision < currentRevision ||
            (revision === currentRevision &&
              current &&
              hasSavedPrimaryWorkspace(current) &&
              !samePrimary(current.primaryWorkspace, project.primaryWorkspace))
          ) {
            mergeRejected = true
            return state
          }
          const merged = current ? mergeProjectCompatibilityProject(current, project) : project
          return {
            projects: state.projects.map((candidate) =>
              candidate.id === projectId ? merged : candidate
            )
          }
        })
        if (mergeRejected) {
          return { error: new Error('Stale primary workspace response') }
        }
        return { project }
      } catch (error) {
        return { error } satisfies ProjectPrimaryWorkspaceResult
      }
    }
  }
}
