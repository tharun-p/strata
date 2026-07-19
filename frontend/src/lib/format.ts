export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** exponent).toFixed(exponent > 2 ? 1 : 0)} ${units[exponent]}`
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat('en', { notation: value > 9999 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value)
}

export function formatCell(value: unknown, dataType = ''): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'object') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (dataType.includes('numeric') || dataType.includes('float')) {
      return new Intl.NumberFormat('en', { maximumFractionDigits: 2 }).format(value)
    }
    return new Intl.NumberFormat('en').format(value)
  }
  if (dataType.includes('timestamp')) {
    const date = new Date(String(value))
    if (!Number.isNaN(date.valueOf())) return date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }
  return String(value)
}

