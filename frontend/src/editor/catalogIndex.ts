import type { CompletionCatalog, CompletionRelation } from '../types'
import {
  quotePostgreSQLIdentifier as quoteIdentifier,
  splitPostgreSQLIdentifier as splitQualified,
  unquotePostgreSQLIdentifier as unquoteIdentifier,
} from './postgresIdentifier'

export type CatalogCandidate = {
  label: string
  apply: string
  type: 'namespace' | 'class' | 'property'
  detail: string
  info?: string
  key: string
}

export type CatalogIndex = {
  revision: number
  schemas: CatalogCandidate[]
  relations: CatalogCandidate[]
  relationsByName: Map<string, CompletionRelation[]>
  relationsByQualifiedName: Map<string, CompletionRelation>
  columnsByRelation: WeakMap<CompletionRelation, CatalogCandidate[]>
}

const NON_ALIAS_KEYWORDS = new Set([
  'where', 'join', 'left', 'right', 'inner', 'full', 'cross', 'on', 'group', 'order',
  'having', 'limit', 'offset', 'union', 'returning', 'window', 'for', 'fetch',
])

function sorted(candidates: CatalogCandidate[]) {
  return candidates.sort((left, right) => left.key.localeCompare(right.key) || left.label.localeCompare(right.label))
}

function matching(candidates: readonly CatalogCandidate[], query: string, limit: number) {
  const trimmed = query.trim()
  const key = (trimmed.startsWith('"') && !trimmed.endsWith('"')
    ? trimmed.slice(1).replaceAll('""', '"')
    : unquoteIdentifier(trimmed)).toLowerCase()
  if (!key) return { items: candidates.slice(0, limit), truncated: candidates.length > limit }
  let low = 0
  let high = candidates.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (candidates[middle].key < key) low = middle + 1
    else high = middle
  }
  const items: CatalogCandidate[] = []
  let cursor = low
  while (cursor < candidates.length && candidates[cursor].key.startsWith(key) && items.length < limit) {
    items.push(candidates[cursor])
    cursor += 1
  }
  return { items, truncated: cursor < candidates.length && candidates[cursor].key.startsWith(key) }
}

function resolveAliases(index: CatalogIndex, sqlBefore: string) {
  const aliases = new Map<string, CompletionRelation>()
  const expression = /\b(?:from|join)\s+((?:"(?:[^"]|"")*"|[A-Za-z_][\w$]*)(?:\.(?:"(?:[^"]|"")*"|[A-Za-z_][\w$]*))?)(?:\s+(?:as\s+)?("(?:[^"]|"")*"|[A-Za-z_][\w$]*))?/gi
  for (const match of sqlBefore.slice(-64_000).matchAll(expression)) {
    const parts = splitQualified(match[1]).map(unquoteIdentifier)
    const qualified = parts.length === 2 ? `${parts[0]}.${parts[1]}` : ''
    const candidates = qualified
      ? [index.relationsByQualifiedName.get(qualified)].filter(Boolean) as CompletionRelation[]
      : index.relationsByName.get(parts[0]) ?? []
    if (candidates.length !== 1) continue
    const relation = candidates[0]
    const parsedAlias = match[2] ? unquoteIdentifier(match[2]) : ''
    const alias = parsedAlias && !NON_ALIAS_KEYWORDS.has(parsedAlias) ? parsedAlias : relation.name.toLowerCase()
    aliases.set(alias, relation)
  }
  return aliases
}

export function createCatalogIndex(revision: number, catalog: CompletionCatalog | null): CatalogIndex {
  const schemas: CatalogCandidate[] = []
  const relations: CatalogCandidate[] = []
  const relationsByName = new Map<string, CompletionRelation[]>()
  const relationsByQualifiedName = new Map<string, CompletionRelation>()
  const columnsByRelation = new WeakMap<CompletionRelation, CatalogCandidate[]>()
  for (const schema of catalog?.schemas ?? []) {
    schemas.push({ label: schema.name, apply: quoteIdentifier(schema.name), type: 'namespace', detail: 'schema', key: schema.name.toLowerCase() })
    for (const relation of schema.relations) {
      const nameKey = relation.name.toLowerCase()
      relationsByName.set(nameKey, [...(relationsByName.get(nameKey) ?? []), relation])
      relationsByQualifiedName.set(`${relation.schema.toLowerCase()}.${nameKey}`, relation)
      columnsByRelation.set(relation, sorted(relation.columns.map((column) => ({
        label: column.name,
        apply: quoteIdentifier(column.name),
        type: 'property' as const,
        detail: column.dataType,
        info: `${relation.schema}.${relation.name}.${column.name}`,
        key: column.name.toLowerCase(),
      }))))
    }
  }
  for (const schema of catalog?.schemas ?? []) {
    for (const relation of schema.relations) {
      const ambiguous = (relationsByName.get(relation.name.toLowerCase())?.length ?? 0) > 1
      const qualified = `${quoteIdentifier(relation.schema)}.${quoteIdentifier(relation.name)}`
      relations.push({
        label: ambiguous ? `${relation.schema}.${relation.name}` : relation.name,
        apply: ambiguous ? qualified : quoteIdentifier(relation.name),
        type: 'class',
        detail: `${relation.schema} · ${relation.kind.includes('view') ? 'view' : 'table'}`,
        info: `${relation.schema}.${relation.name}\n${relation.columns.length} columns`,
        key: relation.name.toLowerCase(),
      })
    }
  }
  return { revision, schemas: sorted(schemas), relations: sorted(relations), relationsByName, relationsByQualifiedName, columnsByRelation }
}

export function completeCatalog(index: CatalogIndex, token: string, sqlBefore: string) {
  const parts = splitQualified(token)
  const query = parts.at(-1) ?? ''
  if (parts.length > 1) {
    const qualifier = unquoteIdentifier(parts.at(-2) ?? '')
    const aliases = resolveAliases(index, sqlBefore)
    const schema = index.schemas.find((candidate) => candidate.key === qualifier)
    const relation = aliases.get(qualifier)
      ?? index.relationsByQualifiedName.get(qualifier)
      ?? (index.relationsByName.get(qualifier)?.length === 1 ? index.relationsByName.get(qualifier)?.[0] : undefined)
    if (relation) return matching(index.columnsByRelation.get(relation) ?? [], query, 100)
    if (schema) {
      const candidates = [...index.relationsByQualifiedName.values()]
        .filter((item) => item.schema.toLowerCase() === qualifier)
        .map((item) => ({
          label: item.name,
          apply: quoteIdentifier(item.name),
          type: 'class' as const,
          detail: item.kind.includes('view') ? 'view' : 'table',
          info: `${item.schema}.${item.name}\n${item.columns.length} columns`,
          key: item.name.toLowerCase(),
        }))
      return matching(sorted(candidates), query, 100)
    }
    return { items: [], truncated: false }
  }
  const schemaMatches = matching(index.schemas, query, 40)
  const relationMatches = matching(index.relations, query, 100 - schemaMatches.items.length)
  return {
    items: [...schemaMatches.items, ...relationMatches.items],
    truncated: schemaMatches.truncated || relationMatches.truncated,
  }
}
