import { dirname } from 'node:path'
import {
  setMigrationUnsupportedPty,
  setMigrationUnsupportedPtyPersistenceListener
} from '../../agent-hooks/migration-unsupported-pty-state'
import { agentHookServer } from '../../agent-hooks/server'
import { ActiveViewPreference } from '../../active-view-preference'
import { registerPersistedPaneKeyAlias } from '../restoring-sessions/pane-alias-normalization'
import { normalizePersistedPaneIdentityState } from '../restoring-sessions/workspace-pane-normalization'
import { StoreRuntimeState, type StoreRuntimeOptions } from './store-runtime-state'
import {
  createStoreDomains,
  installStoreDomainContexts,
  STORE_DOMAIN_OPERATION_CLASSES,
  type StoreDomains
} from './store-domain-composition'
import type { PersistedState } from '../../../shared/persisted-state-types'
import { scheduleSave } from './write-scheduling'
import type { WriteSchedulingOperations } from './write-scheduling'
import type { PrimaryStateWriteOperations } from './primary-state-writes'
import type { ProjectCollectionOperations } from './project-collection-operations'
import type { RepoLifecycleOperations } from './repo-lifecycle-operations'
import type { MobileTabSelectionPersistence } from './mobile-tab-selection-persistence'
import type { SparsePresetPersistence } from './sparse-preset-persistence'
import type { AutomationPersistence } from './automation-persistence'
import type { MetadataLineageOperations } from './metadata-lineage-operations'
import type { ProfilePreferences } from './profile-preferences'
import type { SessionHostPartitionOperations } from './session-host-partitions'
import type { SessionSnapshotOperations } from './session-snapshot-operations'
import type { PtyBindingPersistenceOperations } from './pty-binding-persistence'
import type { SshProfileOperations } from './ssh-profile-operations'
import type { RetiredWorktreeNamePersistence } from './retired-worktree-name-persistence'
import type { SshLeaseRecoveryOperations } from './ssh-lease-recovery-operations'
import type { WriteFlushBarrierOperations } from './write-flush-barriers'
import type { PrimaryRemovalReservation } from '../../../shared/project-primary-removal'
import type { Project } from '../../../shared/project-types'
import type { ProjectHostSetup } from '../../../shared/project-types'
import { ProjectPrimaryAuthorityPersistence } from './project-primary-authority-persistence'

export type StoreOptions = StoreRuntimeOptions
export type PtyBindingSourceExpectation = {
  worktreeId?: string
  tabId: string
  leafId: string
  ptyId: string
  incarnationId?: string
}

/** Concrete composition root for profile persistence. */
// oxlint-disable-next-line typescript-eslint/no-unsafe-declaration-merging -- Store installs the exact concrete domain class descriptors and contexts below
export class Store {
  private readonly runtime: StoreRuntimeState
  private readonly domains: StoreDomains
  private readonly state: PersistedState
  private readonly primaryAuthorityPersistence: ProjectPrimaryAuthorityPersistence

  constructor(options: StoreOptions = {}) {
    this.runtime = new StoreRuntimeState(options)
    this.domains = createStoreDomains(this.runtime)
    installStoreDomainContexts(this, this.domains)
    this.primaryAuthorityPersistence = new ProjectPrimaryAuthorityPersistence({
      projects: () => this.state.projects,
      isWritable: () => !this.runtime.writesFrozen,
      flush: () => this.flushPendingOrThrowAsync(),
      scheduleSave: () => scheduleSave(this.domains.scheduling),
      freezeWrites: () => this.freezeWrites(),
      setPrimaryWorkspace: (id, primary) => this.domains.projects.setPrimaryWorkspace(id, primary)
    })
    this.runtime.flushOrThrow = () => this.flushOrThrow()
    const loaded = this.domains.loader.load()
    const normalized = normalizePersistedPaneIdentityState(loaded)
    this.state = normalized.state
    this.runtime.state = this.state
    this.runtime.activeViewPreference = new ActiveViewPreference(
      this.runtime.dataFile,
      this.state.ui?.activeView
    )
    const adaptedProjectGroups = this.domains.adaptation.adaptFlatFolderScanProjectGroups()
    this.domains.adaptation.hydrateFolderWorkspaceDiffComments()
    // Load is the only place an orphaned repo id can be swept: every removal path needs the repo to
    // still be registered, so rows outlive their owner without one (#17776).
    const sweptRepoIds = this.domains.repos.sweepDeregisteredRepoResidue()
    for (const entry of normalized.migrationUnsupportedEntries) {
      setMigrationUnsupportedPty(entry)
    }
    for (const entry of normalized.legacyPaneKeyAliasEntries) {
      registerPersistedPaneKeyAlias(entry)
    }
    setMigrationUnsupportedPtyPersistenceListener((entries) => {
      this.state.migrationUnsupportedPtyEntries = entries
      scheduleSave(this.domains.scheduling)
    })
    agentHookServer.setPaneKeyAliasPersistenceListener((entries) => {
      this.state.legacyPaneKeyAliasEntries = entries
      scheduleSave(this.domains.scheduling)
    })
    if (
      normalized.changed ||
      this.runtime.loadNeedsSave ||
      adaptedProjectGroups ||
      sweptRepoIds.length > 0
    ) {
      scheduleSave(this.domains.scheduling)
    }
  }

  getProfileStorageDirectory(): string {
    return dirname(this.runtime.dataFile)
  }

  freezeWrites(): void {
    this.runtime.writesFrozen = true
    if (this.runtime.writeTimer) {
      clearTimeout(this.runtime.writeTimer)
      this.runtime.writeTimer = null
    }
  }

  getPrimaryRemovalReservations(): readonly PrimaryRemovalReservation[] {
    return (this.state.primaryRemovalReservations ?? []).map((reservation) => ({
      ...reservation,
      target: { ...reservation.target }
    }))
  }

  get isPrimaryWorkspaceMutationAvailable(): boolean {
    return this.primaryAuthorityPersistence.isAvailable
  }

  async bindPrimaryAuthorityFingerprintDurably(
    id: string,
    fingerprint: string
  ): Promise<Project | null> {
    return this.primaryAuthorityPersistence.bind(id, fingerprint)
  }

  async registerRemoteProjectAuthorityCompatibilityDurably(input: {
    remoteProject: Project
    hostId: ProjectHostSetup['hostId']
    setups: readonly ProjectHostSetup[]
    authorityFingerprint: string
    runtimeOwnerFingerprint?: string
    isCurrent?: () => boolean
  }): Promise<Project> {
    const priorProjects = structuredClone(this.state.projects)
    const priorSetups = structuredClone(this.state.projectHostSetups)
    try {
      if (input.isCurrent && !input.isCurrent()) {
        throw new Error('runtime_environment_changed')
      }
      const { isCurrent, ...registration } = input
      const project = this.domains.projects.registerRemoteProjectAuthorityCompatibility(registration)
      await this.flushPendingOrThrowAsync()
      if (isCurrent && !isCurrent()) {
        throw new Error('runtime_environment_changed')
      }
      return project
    } catch (error) {
      this.state.projects = priorProjects
      this.state.projectHostSetups = priorSetups
      scheduleSave(this.domains.scheduling)
      try {
        await this.flushPendingOrThrowAsync()
      } catch {
        this.freezeWrites()
        throw new Error('remote_project_compatibility_rollback_failed', { cause: error })
      }
      throw error
    }
  }

  async applyPrimaryAuthoritySnapshotDurably(input: {
    projectId: string
    fingerprint: string
    primaryWorkspace: Project['primaryWorkspace'] | null | undefined
    revision: number
  }): Promise<Project | null> {
    return this.primaryAuthorityPersistence.applySnapshot(input)
  }

  async setPrimaryWorkspaceDurably(
    id: string,
    primary: Project['primaryWorkspace'] | undefined
  ): Promise<Project | null> {
    return this.primaryAuthorityPersistence.set(id, primary)
  }

  async savePrimaryRemovalReservation(reservation: PrimaryRemovalReservation): Promise<void> {
    const reservations = this.state.primaryRemovalReservations ?? []
    if (reservations.some((entry) => entry.token === reservation.token)) {
      throw new Error('duplicate_primary_removal_token')
    }
    this.state.primaryRemovalReservations = [
      ...reservations,
      {
        ...reservation,
        target: { ...reservation.target }
      }
    ]
    scheduleSave(this.domains.scheduling)
    await this.flushPendingOrThrowAsync()
  }

  async removePrimaryRemovalReservation(token: string): Promise<void> {
    const reservations = this.state.primaryRemovalReservations ?? []
    this.state.primaryRemovalReservations = reservations.filter((entry) => entry.token !== token)
    scheduleSave(this.domains.scheduling)
    try {
      await this.flushPendingOrThrowAsync()
    } catch (error) {
      this.state.primaryRemovalReservations = reservations
      scheduleSave(this.domains.scheduling)
      throw error
    }
  }
}

// oxlint-disable-next-line typescript-eslint/consistent-type-definitions -- declaration merging derives Store's prototype API directly from the exact concrete domain classes installed below
export interface Store
  extends
    WriteSchedulingOperations,
    PrimaryStateWriteOperations,
    ProjectCollectionOperations,
    RepoLifecycleOperations,
    MobileTabSelectionPersistence,
    SparsePresetPersistence,
    AutomationPersistence,
    MetadataLineageOperations,
    ProfilePreferences,
    SessionHostPartitionOperations,
    SessionSnapshotOperations,
    PtyBindingPersistenceOperations,
    SshProfileOperations,
    RetiredWorktreeNamePersistence,
    SshLeaseRecoveryOperations,
    WriteFlushBarrierOperations {}

for (const OperationClass of STORE_DOMAIN_OPERATION_CLASSES) {
  const descriptors = Object.getOwnPropertyDescriptors(OperationClass.prototype)
  for (const [name, descriptor] of Object.entries(descriptors)) {
    if (name !== 'constructor') {
      Object.defineProperty(Store.prototype, name, descriptor)
    }
  }
}
