export function downloadText(filename: string, contents: string, mime: string) {
  const blob = new Blob([contents], { type: mime })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function escapeCsv(value: unknown) {
  const text = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

export function resultToCsv(columns: Array<{ name: string }>, rows: unknown[][]) {
  const header = columns.map((column) => escapeCsv(column.name)).join(',')
  const body = rows.map((row) => row.map(escapeCsv).join(',')).join('\n')
  return `${header}\n${body}\n`
}

export function resultToJson(columns: Array<{ name: string }>, rows: unknown[][]) {
  return JSON.stringify(rows.map((row) => Object.fromEntries(columns.map((column, index) => [column.name, row[index]]))), null, 2)
}
