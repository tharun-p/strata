import { describe, expect, it } from 'vitest'
import { incrementallyLexPostgreSQLStatements, lexPostgreSQLStatements } from './statementLexer'

describe('statement index performance', () => {
  it('indexes a 100,000-statement, approximately 10 MB script off-thread within the release budget', () => {
    const statement = `SELECT id, created_at, status, total_cents FROM commerce.orders WHERE status = 'completed'; -- pad\n`
    const sql = statement.repeat(100_000)
    expect(sql.length).toBeGreaterThan(9_000_000)
    const started = performance.now()
    const ranges = lexPostgreSQLStatements(sql)
    const initialDuration = performance.now() - started
    expect(ranges).toHaveLength(100_000)
    expect(initialDuration).toBeLessThan(1_500)

    const editAt = ranges[50_000].from + 7
    const incrementalStarted = performance.now()
    const updated = incrementallyLexPostgreSQLStatements(sql, ranges, [{ from: editAt, to: editAt + 2, insert: 'order_id' }])
    const incrementalDuration = performance.now() - incrementalStarted
    expect(updated.ranges).toHaveLength(100_000)
    expect(incrementalDuration).toBeLessThan(50)
  }, 5_000)
})
