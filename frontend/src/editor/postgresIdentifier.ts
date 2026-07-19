export function quotePostgreSQLIdentifier(identifier: string) {
  return /^[a-z_][a-z0-9_$]*$/.test(identifier) ? identifier : `"${identifier.replaceAll('"', '""')}"`
}

export function unquotePostgreSQLIdentifier(identifier: string) {
  const trimmed = identifier.trim()
  return trimmed.startsWith('"') && trimmed.endsWith('"')
    ? trimmed.slice(1, -1).replaceAll('""', '"')
    : trimmed.toLowerCase()
}

export function splitPostgreSQLIdentifier(token: string) {
  const parts: string[] = []
  let current = ''
  let quoted = false
  for (let cursor = 0; cursor < token.length; cursor += 1) {
    const char = token[cursor]
    if (char === '"') {
      current += char
      if (quoted && token[cursor + 1] === '"') {
        current += token[cursor + 1]
        cursor += 1
      } else quoted = !quoted
    } else if (char === '.' && !quoted) {
      parts.push(current)
      current = ''
    } else current += char
  }
  parts.push(current)
  return parts
}
