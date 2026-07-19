export function hashSQL(sql: string) {
  let first = 0x811c9dc5
  let second = 0x9e3779b9
  for (let index = 0; index < sql.length; index += 1) {
    const code = sql.charCodeAt(index)
    first = Math.imul(first ^ code, 0x01000193)
    second = Math.imul(second ^ code, 0x85ebca6b)
  }
  return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`
}

export function isSQLResultFresh(currentRevision: number, currentSQL: string, resultRevision: number | null, resultSQLHash: string | null) {
  return resultRevision === currentRevision && resultSQLHash === hashSQL(currentSQL)
}
