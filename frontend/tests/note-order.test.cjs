// Run from the repository root: node --test frontend/tests/note-order.test.cjs
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const compiled = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../hooks/use-notes.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText
const moduleExports = {}
vm.runInNewContext(compiled, { exports: moduleExports, require: name => {
  assert.equal(name, 'react')
  return {} // Date helpers are pure; no hook or API request is executed.
} })
const { compareNotesByDateDescending: compare } = moduleExports

function note(id, createdAt, diaryDate, updatedAt = createdAt) {
  return { id, createdAt, diaryDate, updatedAt, title: id, category: '日记', content: '' }
}

test('backfilled diary dates determine reading order rather than creation or last edit', () => {
  const earlierDiary = note('1', '2026-10-03 12:00:00', '2026-09-01', '2026-10-03 12:00:00')
  const newerDiary = note('2', '2026-09-25 09:00:00', '2026-09-25')
  const regularNote = note('3', '2026-09-20 18:00:00', null, '2026-10-04 12:00:00')
  const input = [earlierDiary, regularNote, newerDiary]
  assert.deepEqual(input.slice().sort(compare).map(value => value.id), ['2', '3', '1'])
  assert.deepEqual(input.map(value => value.id), ['1', '3', '2'])
})

test('same diary day sorts by creation timestamp with a deterministic id tie break', () => {
  const input = [
    note('2', '2026-10-03 09:00:00', '2026-09-10', '2026-10-05 18:00:00'),
    note('9', '2026-10-03 12:00:00', '2026-09-10'),
    note('10', '2026-10-03 12:00:00', '2026-09-10'),
  ]
  assert.deepEqual(input.slice().sort(compare).map(value => value.id), ['10', '9', '2'])
  assert.deepEqual(input.slice().reverse().sort(compare).map(value => value.id), ['10', '9', '2'])
})

test('ordinary notes use their local creation date and unknown dates remain last', () => {
  const input = [
    note('1', '2026-10-02 23:59:00'),
    note('2', '2026-10-03T00:01:00'),
    note('3', 'invalid'),
  ]
  assert.deepEqual(input.slice().sort(compare).map(value => value.id), ['2', '1', '3'])
})
