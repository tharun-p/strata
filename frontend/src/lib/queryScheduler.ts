import type { DocumentActivity } from '../types'

export class QueryCancelledError extends Error {
  constructor() {
    super('Query was cancelled')
    this.name = 'QueryCancelledError'
  }
}

type Job<T = unknown> = {
  activity: DocumentActivity
  run: () => Promise<T>
  cancel: () => Promise<unknown>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
}

export type ScheduledJob<T> = {
  requestId: string
  promise: Promise<T>
}

export type QueryJobSpec<T> = {
  requestId: string
  documentId: string
  connectionId: string
  kind: DocumentActivity['kind']
  run: () => Promise<T>
  cancel: () => Promise<unknown>
}

export class QueryScheduler {
  private readonly queue: Job[] = []
  private readonly running = new Map<string, Job>()
  private readonly activeDocuments = new Set<string>()
  private readonly listeners = new Set<(activities: DocumentActivity[]) => void>()

  constructor(
    readonly globalLimit = 8,
    readonly connectionLimit = 4,
  ) {}

  subscribe(listener: (activities: DocumentActivity[]) => void) {
    this.listeners.add(listener)
    listener(this.activities())
    return () => { this.listeners.delete(listener) }
  }

  activities() {
    return [
      ...this.running.values(),
      ...this.queue,
    ].map((job) => ({ ...job.activity }))
  }

  submit<T>(spec: QueryJobSpec<T>): ScheduledJob<T> {
    if (this.activeDocuments.has(spec.documentId)) {
      return {
        requestId: spec.requestId,
        promise: Promise.reject(new Error('This worksheet already has a queued or running operation')),
      }
    }
    let resolveJob!: (value: T) => void
    let rejectJob!: (reason: unknown) => void
    const promise = new Promise<T>((resolve, reject) => {
      resolveJob = resolve
      rejectJob = reject
    })
    const job: Job<T> = {
      activity: {
        requestId: spec.requestId,
        documentId: spec.documentId,
        connectionId: spec.connectionId,
        kind: spec.kind,
        status: 'queued',
      },
      run: spec.run,
      cancel: spec.cancel,
      resolve: resolveJob,
      reject: rejectJob,
    }
    this.activeDocuments.add(spec.documentId)
    this.queue.push(job as Job)
    this.emit()
    this.pump()
    return { requestId: spec.requestId, promise }
  }

  async cancel(requestId: string) {
    const queuedIndex = this.queue.findIndex((job) => job.activity.requestId === requestId)
    if (queuedIndex >= 0) {
      const [job] = this.queue.splice(queuedIndex, 1)
      this.activeDocuments.delete(job.activity.documentId)
      job.reject(new QueryCancelledError())
      this.emit()
      this.pump()
      return true
    }
    const job = this.running.get(requestId)
    if (!job) return false
    job.activity.status = 'cancelling'
    this.emit()
    await job.cancel()
    return true
  }

  async cancelDocument(documentId: string) {
    const requestIDs = this.activities()
      .filter((activity) => activity.documentId === documentId)
      .map((activity) => activity.requestId)
    await Promise.all(requestIDs.map((requestId) => this.cancel(requestId)))
  }

  async cancelDocuments(documentIds: readonly string[]) {
    const ids = new Set(documentIds)
    const requestIDs = this.activities()
      .filter((activity) => ids.has(activity.documentId))
      .map((activity) => activity.requestId)
    await Promise.all(requestIDs.map((requestId) => this.cancel(requestId)))
  }

  private pump() {
    while (this.running.size < this.globalLimit) {
      const connectionCounts = new Map<string, number>()
      for (const running of this.running.values()) {
        connectionCounts.set(running.activity.connectionId, (connectionCounts.get(running.activity.connectionId) ?? 0) + 1)
      }
      const nextIndex = this.queue.findIndex((job) => (connectionCounts.get(job.activity.connectionId) ?? 0) < this.connectionLimit)
      if (nextIndex < 0) return
      const [job] = this.queue.splice(nextIndex, 1)
      job.activity.status = 'running'
      job.activity.startedAt = new Date().toISOString()
      this.running.set(job.activity.requestId, job)
      this.emit()
      void job.run().then(job.resolve, job.reject).finally(() => {
        this.running.delete(job.activity.requestId)
        this.activeDocuments.delete(job.activity.documentId)
        this.emit()
        this.pump()
      })
    }
  }

  private emit() {
    const snapshot = this.activities()
    for (const listener of this.listeners) listener(snapshot)
  }
}
