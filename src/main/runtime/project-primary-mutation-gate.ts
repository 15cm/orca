import { randomUUID } from 'node:crypto'
import { normalizeExecutionHostId, parseExecutionHostId } from '../../shared/execution-host'
import type {
  PrimaryRemovalReservation,
  PrimaryWorkspaceTarget
} from '../../shared/project-primary-removal'
export type {
  PrimaryRemovalReservation,
  PrimaryWorkspaceTarget
} from '../../shared/project-primary-removal'

export type PrimaryRemovalReservationStore = {
  load: () => Promise<readonly PrimaryRemovalReservation[]>
  save: (reservation: PrimaryRemovalReservation) => Promise<void>
  remove: (token: string) => Promise<void>
}

export type PrimaryMutationGateOptions = {
  store: PrimaryRemovalReservationStore
  isAuthorityAvailable: () => boolean
  getPrimary: (projectId: string) => PrimaryWorkspaceTarget | undefined
  confirmRemovalCompletion: (reservation: PrimaryRemovalReservation) => Promise<boolean>
  makeToken?: () => string
}

export class PrimaryMutationError extends Error {
  constructor(
    readonly code:
      | 'authority_unavailable'
      | 'primary_removal_pending'
      | 'primary_selected'
      | 'unknown_removal_token'
      | 'owner_mismatch'
  ) {
    super(code)
    this.name = 'PrimaryMutationError'
  }
}

function sameTarget(left: PrimaryWorkspaceTarget, right: PrimaryWorkspaceTarget): boolean {
  return (
    left.peerFingerprint === right.peerFingerprint &&
    left.hostId === right.hostId &&
    left.instanceId === right.instanceId
  )
}

function validateTarget(target: PrimaryWorkspaceTarget): PrimaryWorkspaceTarget {
  const hostId = normalizeExecutionHostId(target.hostId)
  if (
    !target.peerFingerprint.trim() ||
    !hostId ||
    hostId !== target.hostId ||
    parseExecutionHostId(hostId)?.kind === 'runtime' ||
    !target.instanceId.trim() ||
    (target.path !== undefined && !target.path.trim())
  ) {
    throw new Error('invalid_primary_removal_target')
  }
  return { ...target }
}

export class ProjectPrimaryMutationGate {
  private readonly tails = new Map<string, Promise<unknown>>()
  private reservations = new Map<string, PrimaryRemovalReservation>()
  private readonly ready: Promise<void>

  constructor(private readonly options: PrimaryMutationGateOptions) {
    this.ready = options.store.load().then((reservations) => {
      const validated = reservations.map(validateReservation)
      const loaded = new Map<string, PrimaryRemovalReservation>()
      for (const reservation of validated) {
        if (loaded.has(reservation.token)) {
          throw new Error('duplicate_primary_removal_token')
        }
        loaded.set(reservation.token, reservation)
      }
      this.reservations = loaded
    })
  }

  async withPrimaryChange<T>(
    projectId: string,
    target: PrimaryWorkspaceTarget,
    operation: () => Promise<T> | T
  ): Promise<T> {
    return this.enqueue(projectId, async () => {
      await this.ready
      this.assertAuthority()
      if (this.hasPendingProjectMutation(projectId)) {
        throw new PrimaryMutationError('primary_removal_pending')
      }
      validateTarget(target)
      if (this.hasPendingRemoval(projectId, target)) {
        throw new PrimaryMutationError('primary_removal_pending')
      }
      return operation()
    })
  }

  async withProjectMutation<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
    return this.withProjectLock(projectId, async () => {
      this.assertAuthority()
      if (this.hasPendingProjectMutation(projectId)) {
        throw new PrimaryMutationError('primary_removal_pending')
      }
      return operation()
    })
  }

  async withProjectLock<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
    return this.enqueue(projectId, async () => {
      await this.ready
      return operation()
    })
  }

  assertAuthorityAvailable(): void {
    this.assertAuthority()
  }

  async assertRemovalOwner(token: string, owner: PrimaryWorkspaceTarget): Promise<void> {
    await this.ready
    validateTarget(owner)
    const reservation = this.reservations.get(token)
    if (!reservation || reservation.scope === 'project') {
      throw new PrimaryMutationError('unknown_removal_token')
    }
    if (!sameTarget(reservation.target, owner)) {
      throw new PrimaryMutationError('owner_mismatch')
    }
  }

  async beginRemoval(projectId: string, target: PrimaryWorkspaceTarget): Promise<string> {
    return this.enqueue(projectId, async () => {
      await this.ready
      this.assertAuthority()
      if (this.hasPendingProjectMutation(projectId)) {
        throw new PrimaryMutationError('primary_removal_pending')
      }
      validateTarget(target)
      const current = this.options.getPrimary(projectId)
      if (current && sameTarget(current, target)) {
        throw new PrimaryMutationError('primary_selected')
      }
      if (this.hasPendingRemoval(projectId, target)) {
        throw new PrimaryMutationError('primary_removal_pending')
      }
      const reservation: PrimaryRemovalReservation = {
        token: (this.options.makeToken ?? randomUUID)(),
        projectId,
        target: { ...target }
      }
      // Save first. A failed durable write never hands out a deletion permit.
      this.reservations.set(reservation.token, reservation)
      await this.options.store.save(reservation)
      return reservation.token
    })
  }

  async beginProjectMutationPermit(
    projectId: string,
    resourceKey: string,
    requesterFingerprint: string,
    preflight?: () => Promise<void>
  ): Promise<string> {
    if (!resourceKey.trim() || !requesterFingerprint.trim()) {
      throw new Error('invalid_primary_project_mutation_resource')
    }
    return this.enqueue(projectId, async () => {
      await this.ready
      this.assertAuthority()
      if (this.hasPendingProjectMutation(projectId)) {
        throw new PrimaryMutationError('primary_removal_pending')
      }
      await preflight?.()
      const token = (this.options.makeToken ?? randomUUID)()
      const target = this.options.getPrimary(projectId) ?? {
        peerFingerprint: 'project-mutation',
        hostId: 'local',
        instanceId: `project-mutation:${token}`
      }
      const reservation: PrimaryRemovalReservation = {
        token,
        projectId,
        target: { ...target },
        scope: 'project',
        resourceKey,
        requesterFingerprint
      }
      this.reservations.set(token, reservation)
      await this.options.store.save(reservation)
      return token
    })
  }

  async finishProjectMutationPermit(
    token: string,
    expected: { projectId: string; resourceKey: string; requesterFingerprint: string },
    isCurrent: () => boolean = () => true
  ): Promise<boolean> {
    await this.ready
    const reservation = this.reservations.get(token)
    if (!reservation || reservation.scope !== 'project') {
      return false
    }
    return this.enqueue(reservation.projectId, async () => {
      await this.ready
      this.assertAuthority()
      const current = this.reservations.get(token)
      if (
        !current ||
        current.scope !== 'project' ||
        current.projectId !== expected.projectId ||
        current.resourceKey !== expected.resourceKey ||
        current.requesterFingerprint !== expected.requesterFingerprint ||
        !isCurrent()
      ) {
        return false
      }
      await this.options.store.remove(token)
      this.reservations.delete(token)
      return true
    })
  }

  async withRemovalGuard<T>(
    projectId: string,
    target: PrimaryWorkspaceTarget,
    operation: () => Promise<T>
  ): Promise<T> {
    return this.enqueue(projectId, async () => {
      await this.ready
      this.assertAuthority()
      if (this.hasPendingProjectMutation(projectId)) {
        throw new PrimaryMutationError('primary_removal_pending')
      }
      validateTarget(target)
      const current = this.options.getPrimary(projectId)
      if (current && sameTarget(current, target)) {
        throw new PrimaryMutationError('primary_selected')
      }
      if (this.hasPendingRemoval(projectId, target)) {
        throw new PrimaryMutationError('primary_removal_pending')
      }
      return operation()
    })
  }

  async finishRemoval(token: string, owner: PrimaryWorkspaceTarget): Promise<boolean> {
    validateTarget(owner)
    const reservation = await this.ready.then(() => this.reservations.get(token))
    if (!reservation || reservation.scope === 'project') {
      return false
    }
    return this.enqueue(reservation.projectId, async () => {
      await this.ready
      const current = this.reservations.get(token)
      if (!current) {
        return false
      }
      this.assertAuthority()
      if (!sameTarget(current.target, owner)) {
        throw new PrimaryMutationError('owner_mismatch')
      }
      if (!(await this.options.confirmRemovalCompletion(current))) {
        return false
      }
      await this.options.store.remove(token)
      this.reservations.delete(token)
      return true
    })
  }

  private hasPendingRemoval(projectId: string, target: PrimaryWorkspaceTarget): boolean {
    return [...this.reservations.values()].some(
      (reservation) =>
        reservation.scope !== 'project' &&
        reservation.projectId === projectId &&
        sameTarget(reservation.target, target)
    )
  }

  private hasPendingProjectMutation(projectId: string): boolean {
    return [...this.reservations.values()].some(
      (reservation) => reservation.projectId === projectId && reservation.scope === 'project'
    )
  }

  private assertAuthority(): void {
    if (!this.options.isAuthorityAvailable()) {
      throw new PrimaryMutationError('authority_unavailable')
    }
  }

  private enqueue<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(projectId) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(operation)
    this.tails.set(projectId, current)
    const cleanup = () => {
      if (this.tails.get(projectId) === current) {
        this.tails.delete(projectId)
      }
    }
    void current.then(cleanup, cleanup)
    return current
  }
}

function validateReservation(value: PrimaryRemovalReservation): PrimaryRemovalReservation {
  if (
    !value ||
    typeof value !== 'object' ||
    typeof value.token !== 'string' ||
    value.token.length === 0 ||
    typeof value.projectId !== 'string' ||
    value.projectId.length === 0 ||
    !value.target ||
    typeof value.target.peerFingerprint !== 'string' ||
    value.target.peerFingerprint.length === 0 ||
    typeof value.target.hostId !== 'string' ||
    value.target.hostId.length === 0 ||
    typeof value.target.instanceId !== 'string' ||
    value.target.instanceId.length === 0 ||
    (value.scope !== undefined && value.scope !== 'owner' && value.scope !== 'project') ||
    (value.scope === 'project' &&
      (typeof value.resourceKey !== 'string' || value.resourceKey.length === 0 ||
        typeof value.requesterFingerprint !== 'string' || value.requesterFingerprint.length === 0))
  ) {
    throw new Error('invalid_primary_removal_reservation')
  }
  const target = validateTarget(value.target)
  return {
    token: value.token,
    projectId: value.projectId,
    target,
    ...(value.scope ? { scope: value.scope } : {}),
    ...(value.resourceKey ? { resourceKey: value.resourceKey } : {}),
    ...(value.requesterFingerprint ? { requesterFingerprint: value.requesterFingerprint } : {})
  }
}
