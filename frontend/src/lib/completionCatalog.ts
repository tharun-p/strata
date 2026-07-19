import type { CompletionCatalog } from '../types'

export function catalogLabel(catalog: CompletionCatalog | null, loading: boolean) {
  if (loading) return 'Loading schema…'
  if (!catalog) return 'No schema cache'
  const relations = catalog.schemas.reduce((sum, schema) => sum + schema.relations.length, 0)
  return `${catalog.schemas.length} schemas · ${relations} relations`
}
