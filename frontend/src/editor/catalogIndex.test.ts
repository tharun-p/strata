import { describe, expect, it } from 'vitest'
import type { CompletionCatalog } from '../types'
import { completeCatalog, createCatalogIndex } from './catalogIndex'

describe('catalog completion index', () => {
  const catalog: CompletionCatalog = {
    schemas: [
      { name: 'public', relations: [{ schema: 'public', name: 'customers', kind: 'table', columns: [{ name: 'customer_id', dataType: 'uuid' }, { name: 'Display Name', dataType: 'text' }] }] },
      { name: 'audit', relations: [{ schema: 'audit', name: 'customers', kind: 'view', columns: [{ name: 'event_id', dataType: 'bigint' }] }] },
    ],
  }

  it('qualifies ambiguous relations and resolves schema, relation and alias contexts', () => {
    const index = createCatalogIndex(1, catalog)
    expect(completeCatalog(index, 'cust', 'SELECT ').items.map((item) => item.apply)).toEqual(['audit.customers', 'public.customers'])
    expect(completeCatalog(index, 'public.', 'SELECT * FROM ').items[0].label).toBe('customers')
    expect(completeCatalog(index, 'c.cust', 'SELECT c. FROM public.customers AS c').items[0].label).toBe('customer_id')
    expect(completeCatalog(index, 'customers."Dis', 'SELECT * FROM public.customers').items[0].apply).toBe('"Display Name"')
  })

  it('serves a 200,000-column index within the completion budget', () => {
    const columns = Array.from({ length: 200_000 }, (_, number) => ({ name: `column_${String(number).padStart(6, '0')}`, dataType: 'text' }))
    const large: CompletionCatalog = { schemas: [{ name: 'public', relations: [{ schema: 'public', name: 'events', kind: 'table', columns }] }] }
    const index = createCatalogIndex(2, large)
    const started = performance.now()
    const result = completeCatalog(index, 'events.column_1999', 'SELECT events. FROM public.events')
    expect(performance.now() - started).toBeLessThan(100)
    expect(result.items[0].label).toBe('column_199900')
  }, 5_000)
})
