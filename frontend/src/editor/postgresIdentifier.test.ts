import { describe, expect, it } from 'vitest'
import {
  quotePostgreSQLIdentifier,
  splitPostgreSQLIdentifier,
  unquotePostgreSQLIdentifier,
} from './postgresIdentifier'

describe('PostgreSQL identifiers', () => {
  it('quotes mixed-case, reserved-looking and embedded-quote identifiers', () => {
    expect(quotePostgreSQLIdentifier('orders')).toBe('orders')
    expect(quotePostgreSQLIdentifier('Order')).toBe('"Order"')
    expect(quotePostgreSQLIdentifier('order items')).toBe('"order items"')
    expect(quotePostgreSQLIdentifier('a"b')).toBe('"a""b"')
  })

  it('splits qualified quoted names without splitting quoted dots', () => {
    expect(splitPostgreSQLIdentifier('"reporting.v2"."Order Items".id')).toEqual(['"reporting.v2"', '"Order Items"', 'id'])
    expect(unquotePostgreSQLIdentifier('"A""B"')).toBe('A"B')
  })
})
