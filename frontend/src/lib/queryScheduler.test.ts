import { describe, expect, it } from 'vitest'
import { QueryCancelledError, QueryScheduler } from './queryScheduler'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('QueryScheduler', () => {
  it('enforces global, per-connection and per-document limits', async () => {
    const scheduler = new QueryScheduler(8, 4)
    const gates = Array.from({ length: 10 }, () => deferred<number>())
    const jobs = gates.map((gate, index) => scheduler.submit({
      requestId: `request-${index}`,
      documentId: `document-${index}`,
      connectionId: index < 6 ? 'primary' : 'secondary',
      kind: 'query',
      run: () => gate.promise,
      cancel: async () => true,
    }))
    const running = scheduler.activities().filter((activity) => activity.status === 'running')
    expect(running).toHaveLength(8)
    expect(running.filter((activity) => activity.connectionId === 'primary')).toHaveLength(4)
    expect(running.filter((activity) => activity.connectionId === 'secondary')).toHaveLength(4)
    const duplicate = scheduler.submit({
      requestId: 'duplicate', documentId: 'document-0', connectionId: 'secondary', kind: 'query',
      run: async () => 0, cancel: async () => true,
    })
    await expect(duplicate.promise).rejects.toThrow('already has')
    gates.forEach((gate, index) => gate.resolve(index))
    await Promise.all(jobs.map((job) => job.promise))
  })

  it('starts the oldest eligible job without letting a saturated connection block others', async () => {
    const scheduler = new QueryScheduler(2, 1)
    const a1 = deferred<number>()
    const a2 = deferred<number>()
    const b1 = deferred<number>()
    const first = scheduler.submit({ requestId: 'a1', documentId: 'd1', connectionId: 'a', kind: 'query', run: () => a1.promise, cancel: async () => true })
    const second = scheduler.submit({ requestId: 'a2', documentId: 'd2', connectionId: 'a', kind: 'query', run: () => a2.promise, cancel: async () => true })
    const third = scheduler.submit({ requestId: 'b1', documentId: 'd3', connectionId: 'b', kind: 'query', run: () => b1.promise, cancel: async () => true })
    expect(scheduler.activities().filter((activity) => activity.status === 'running').map((activity) => activity.requestId)).toEqual(['a1', 'b1'])
    a1.resolve(1)
    await first.promise
    await Promise.resolve()
    expect(scheduler.activities().find((activity) => activity.requestId === 'a2')?.status).toBe('running')
    a2.resolve(2)
    b1.resolve(3)
    await Promise.all([second.promise, third.promise])
  })

  it('cancels queued work independently', async () => {
    const scheduler = new QueryScheduler(1, 1)
    const gate = deferred<number>()
    const first = scheduler.submit({ requestId: 'one', documentId: 'd1', connectionId: 'a', kind: 'query', run: () => gate.promise, cancel: async () => true })
    const second = scheduler.submit({ requestId: 'two', documentId: 'd2', connectionId: 'a', kind: 'query', run: async () => 2, cancel: async () => true })
    expect(await scheduler.cancel('two')).toBe(true)
    await expect(second.promise).rejects.toBeInstanceOf(QueryCancelledError)
    gate.resolve(1)
    await first.promise
  })
})
