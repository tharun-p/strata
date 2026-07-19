import { describe, expect, it } from 'vitest'
import { hashSQL, isSQLResultFresh } from './sqlHash'

describe('SQL result freshness', () => {
  it('becomes stale after any document edit, even when an old result arrives late', () => {
    const sql = 'select 1'
    expect(isSQLResultFresh(4, sql, 4, hashSQL(sql))).toBe(true)
    expect(isSQLResultFresh(5, `${sql};`, 4, hashSQL(sql))).toBe(false)
  })
})
