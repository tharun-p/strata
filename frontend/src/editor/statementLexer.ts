export type TextChange = {
  from: number
  to: number
  insert: string
}

export type StatementRange = {
  from: number
  to: number
  index: number
}

function isSpace(char: string) {
  return char === ' ' || char === '\t' || char === '\r' || char === '\n' || char === '\f'
}

function dollarTagAt(text: string, offset: number) {
  if (text.charCodeAt(offset) !== 36) return ''
  let cursor = offset + 1
  if (text.charCodeAt(cursor) === 36) return '$$'
  const first = text[cursor]
  if (!first || !/[A-Za-z_]/.test(first)) return ''
  cursor += 1
  while (cursor < text.length && /[A-Za-z0-9_]/.test(text[cursor])) cursor += 1
  return text.charCodeAt(cursor) === 36 ? text.slice(offset, cursor + 1) : ''
}

/**
 * Lex PostgreSQL statements without constructing a syntax tree. Offsets use
 * JavaScript UTF-16 units, which is the coordinate system CodeMirror uses.
 */
export function lexPostgreSQLStatements(text: string, offset = 0): StatementRange[] {
  const ranges: StatementRange[] = []
  let segmentStart = 0
  let meaningfulStart = -1
  let hasCode = false
  let cursor = 0

  const beginMeaningful = (at: number) => {
    if (meaningfulStart < 0) meaningfulStart = at
  }
  const finish = (to: number) => {
    if (hasCode) {
      const from = meaningfulStart < 0 ? segmentStart : meaningfulStart
      ranges.push({ from: offset + from, to: offset + to, index: ranges.length })
    }
    segmentStart = to
    meaningfulStart = -1
    hasCode = false
  }

  while (cursor < text.length) {
    const char = text[cursor]
    const next = text[cursor + 1]

    if (isSpace(char)) {
      cursor += 1
      continue
    }

    if (char === '-' && next === '-') {
      beginMeaningful(cursor)
      cursor += 2
      while (cursor < text.length && text[cursor] !== '\n') cursor += 1
      continue
    }

    if (char === '/' && next === '*') {
      beginMeaningful(cursor)
      cursor += 2
      let depth = 1
      while (cursor < text.length && depth > 0) {
        if (text[cursor] === '/' && text[cursor + 1] === '*') {
          depth += 1
          cursor += 2
        } else if (text[cursor] === '*' && text[cursor + 1] === '/') {
          depth -= 1
          cursor += 2
        } else {
          cursor += 1
        }
      }
      continue
    }

    if (char === ';') {
      finish(cursor + 1)
      cursor += 1
      continue
    }

    beginMeaningful(cursor)
    hasCode = true

    const escapedString = char === '\''
      && cursor > 0
      && (text[cursor - 1] === 'E' || text[cursor - 1] === 'e')
      && (cursor < 2 || !/[A-Za-z0-9_$]/.test(text[cursor - 2]))
    if (char === '\'') {
      cursor += 1
      while (cursor < text.length) {
        if (escapedString && text[cursor] === '\\') {
          cursor = Math.min(text.length, cursor + 2)
        } else if (text[cursor] === '\'' && text[cursor + 1] === '\'') {
          cursor += 2
        } else if (text[cursor] === '\'') {
          cursor += 1
          break
        } else {
          cursor += 1
        }
      }
      continue
    }

    if (char === '"') {
      cursor += 1
      while (cursor < text.length) {
        if (text[cursor] === '"' && text[cursor + 1] === '"') cursor += 2
        else if (text[cursor] === '"') {
          cursor += 1
          break
        } else cursor += 1
      }
      continue
    }

    if (char === '$') {
      const tag = dollarTagAt(text, cursor)
      if (tag) {
        cursor += tag.length
        const close = text.indexOf(tag, cursor)
        cursor = close < 0 ? text.length : close + tag.length
        continue
      }
    }

    cursor += 1
  }

  finish(text.length)
  return ranges
}

export function applyTextChanges(text: string, changes: readonly TextChange[]) {
  let next = text
  const ordered = [...changes].sort((left, right) => right.from - left.from)
  for (const change of ordered) {
    next = next.slice(0, change.from) + change.insert + next.slice(change.to)
  }
  return next
}

function hasNeutralLexerState(text: string) {
  let cursor = 0
  while (cursor < text.length) {
    const char = text[cursor]
    const next = text[cursor + 1]
    if (char === '-' && next === '-') {
      cursor += 2
      while (cursor < text.length && text[cursor] !== '\n') cursor += 1
      continue
    }
    if (char === '/' && next === '*') {
      cursor += 2
      let depth = 1
      while (cursor < text.length && depth > 0) {
        if (text[cursor] === '/' && text[cursor + 1] === '*') {
          depth += 1
          cursor += 2
        } else if (text[cursor] === '*' && text[cursor + 1] === '/') {
          depth -= 1
          cursor += 2
        } else cursor += 1
      }
      if (depth > 0) return false
      continue
    }
    if (char === '\'') {
      const escaped = cursor > 0
        && (text[cursor - 1] === 'E' || text[cursor - 1] === 'e')
        && (cursor < 2 || !/[A-Za-z0-9_$]/.test(text[cursor - 2]))
      cursor += 1
      let closed = false
      while (cursor < text.length) {
        if (escaped && text[cursor] === '\\') cursor = Math.min(text.length, cursor + 2)
        else if (text[cursor] === '\'' && text[cursor + 1] === '\'') cursor += 2
        else if (text[cursor] === '\'') {
          cursor += 1
          closed = true
          break
        } else cursor += 1
      }
      if (!closed) return false
      continue
    }
    if (char === '"') {
      cursor += 1
      let closed = false
      while (cursor < text.length) {
        if (text[cursor] === '"' && text[cursor + 1] === '"') cursor += 2
        else if (text[cursor] === '"') {
          cursor += 1
          closed = true
          break
        } else cursor += 1
      }
      if (!closed) return false
      continue
    }
    if (char === '$') {
      const tag = dollarTagAt(text, cursor)
      if (tag) {
        cursor += tag.length
        const close = text.indexOf(tag, cursor)
        if (close < 0) return false
        cursor = close + tag.length
        continue
      }
    }
    cursor += 1
  }
  return true
}

/**
 * Re-index from the end of the last definitely complete statement preceding
 * the edit. A semicolon boundary is a safe PostgreSQL lexer restart point.
 */
export function incrementallyLexPostgreSQLStatements(
  previousText: string,
  previousRanges: readonly StatementRange[],
  changes: readonly TextChange[],
) {
  if (changes.length === 0) return { text: previousText, ranges: [...previousRanges] }
  const earliest = Math.min(...changes.map((change) => change.from))
  const nextText = applyTextChanges(previousText, changes)
  const latest = Math.max(...changes.map((change) => change.to))
  const totalDelta = changes.reduce((sum, change) => sum + change.insert.length - (change.to - change.from), 0)
  let prefixCount = previousRanges.findIndex((range) => range.to > earliest)
  if (prefixCount < 0) prefixCount = previousRanges.length
  const restart = prefixCount > 0 ? previousRanges[prefixCount - 1].to : 0
  const nextRestart = restart
  const prefix = previousRanges.slice(0, prefixCount).map((range, index) => ({ ...range, index }))

  for (let boundaryIndex = prefixCount; boundaryIndex < previousRanges.length; boundaryIndex += 1) {
    const boundary = previousRanges[boundaryIndex].to
    if (boundary < latest || previousText[boundary - 1] !== ';') continue
    if (changes.some((change) => change.from < boundary && change.to >= boundary)) continue
    const mappedBoundary = boundary + totalDelta
    if (nextText[mappedBoundary - 1] !== ';') continue
    const changedWindow = nextText.slice(nextRestart, mappedBoundary)
    if (!hasNeutralLexerState(changedWindow)) continue
    const changedRanges = lexPostgreSQLStatements(changedWindow, nextRestart)
      .map((range, index) => ({ ...range, index: prefix.length + index }))
    const reused = previousRanges.slice(boundaryIndex + 1).map((range, index) => ({
      from: range.from + totalDelta,
      to: range.to + totalDelta,
      index: prefix.length + changedRanges.length + index,
    }))
    return { text: nextText, ranges: [...prefix, ...changedRanges, ...reused] }
  }

  const suffix = lexPostgreSQLStatements(nextText.slice(nextRestart), nextRestart)
    .map((range, index) => ({ ...range, index: prefix.length + index }))
  return { text: nextText, ranges: [...prefix, ...suffix] }
}

export function packStatementRanges(ranges: readonly StatementRange[]) {
  const packed = new Uint32Array(ranges.length * 2)
  ranges.forEach((range, index) => {
    packed[index * 2] = range.from
    packed[index * 2 + 1] = range.to
  })
  return packed
}

export function unpackStatementRanges(packed: Uint32Array): StatementRange[] {
  const ranges: StatementRange[] = []
  for (let index = 0; index + 1 < packed.length; index += 2) {
    ranges.push({ from: packed[index], to: packed[index + 1], index: index / 2 })
  }
  return ranges
}
