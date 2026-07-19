import { describe, expect, it } from 'vitest'
import {
  incrementallyLexPostgreSQLStatements,
  lexPostgreSQLStatements,
} from './statementLexer'

function statements(sql: string) {
  return lexPostgreSQLStatements(sql).map((range) => sql.slice(range.from, range.to))
}

describe('PostgreSQL statement lexer', () => {
  it('keeps comments with their following statement and ignores empty segments', () => {
    const sql = ' ; -- why\nSELECT 1;; /* next */\n SELECT 2; ;'
    expect(statements(sql)).toEqual(['-- why\nSELECT 1;', '/* next */\n SELECT 2;'])
  })

  it('ignores semicolons in PostgreSQL literals and identifiers', () => {
    const sql = `SELECT ';', E'escaped\\';still', "odd;name"; SELECT 2;`
    expect(statements(sql)).toHaveLength(2)
    expect(statements(sql)[0]).toContain('odd;name')
  })

  it('handles tagged dollar quotes and nested block comments', () => {
    const sql = 'DO $body$ BEGIN PERFORM 1; PERFORM 2; END $body$; /* a /* b; */ c */ SELECT 3;'
    expect(statements(sql)).toHaveLength(2)
  })

  it('returns malformed trailing statements instead of dropping them', () => {
    const sql = "SELECT 'unfinished; value"
    expect(statements(sql)).toEqual([sql])
  })

  it('uses exclusive ends at adjacent statement boundaries', () => {
    const sql = 'SELECT 1;SELECT 2;'
    const ranges = lexPostgreSQLStatements(sql)
    expect(ranges[0].to).toBe(ranges[1].from)
    expect(sql.slice(ranges[0].from, ranges[0].to)).toBe('SELECT 1;')
  })

  it('incrementally re-indexes from a safe completed statement boundary', () => {
    const original = 'SELECT 1;\nSELECT 2;\nSELECT 3;'
    const previous = lexPostgreSQLStatements(original)
    const from = original.indexOf('2')
    const indexed = incrementallyLexPostgreSQLStatements(original, previous, [{ from, to: from + 1, insert: "'two;still'" }])
    expect(statements(indexed.text)).toEqual(["SELECT 1;", "SELECT 'two;still';", 'SELECT 3;'])
    expect(indexed.ranges).toEqual(lexPostgreSQLStatements(indexed.text))
  })

  it('does not skip an insertion at the previous statement end', () => {
    const original = 'SELECT 1;SELECT 2;'
    const previous = lexPostgreSQLStatements(original)
    const boundary = previous[0].to
    const indexed = incrementallyLexPostgreSQLStatements(original, previous, [{ from: boundary, to: boundary, insert: 'SELECT 9;' }])
    expect(indexed.ranges).toEqual(lexPostgreSQLStatements(indexed.text))
    expect(indexed.ranges).toHaveLength(3)
  })

  it('keeps sequential characters in one unfinished trailing statement', () => {
    let text = ''
    let ranges = lexPostgreSQLStatements(text)
    for (const character of 'SELECT customer_id FROM customers') {
      const at = text.length
      const indexed = incrementallyLexPostgreSQLStatements(text, ranges, [{ from: at, to: at, insert: character }])
      text = indexed.text
      ranges = indexed.ranges
      expect(ranges).toEqual(lexPostgreSQLStatements(text))
      expect(ranges).toHaveLength(1)
    }
  })

  it('expands incremental work when an edit changes lexical state across boundaries', () => {
    const original = 'SELECT 1;SELECT 2;SELECT 3;'
    const previous = lexPostgreSQLStatements(original)
    const at = original.indexOf('2')
    const indexed = incrementallyLexPostgreSQLStatements(original, previous, [{ from: at, to: at + 1, insert: "'open" }])
    expect(indexed.ranges).toEqual(lexPostgreSQLStatements(indexed.text))
  })
})
