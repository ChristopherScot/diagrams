import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createDotDocument, vizValidator, DotValidationError } from '../lib/dot-document.js'
import { DotSyntaxError, DotEditError } from '../lib/dot-text.js'

const start = 'digraph {\n  a -> b\n}\n'

test('a valid edit is kept and recorded for undo', () => {
  const changes = []
  const document = createDotDocument(start, { onChange: (text, { cause }) => changes.push(cause) })
  const result = document.apply({ type: 'addEdge', from: 'b', to: 'c' })
  assert.deepEqual(result, { ok: true, changed: true })
  assert.match(document.text, /b -> c/)
  assert.ok(document.undo())
  assert.equal(document.text, start)
  assert.ok(document.redo())
  assert.match(document.text, /b -> c/)
  assert.deepEqual(changes, ['edit', 'undo', 'redo'])
})

test('an edit the validator rejects leaves the text and history alone', () => {
  const document = createDotDocument(start, {
    validate: text => {
      if (text.includes('forbidden')) throw new DotValidationError('No forbidden boxes')
    },
  })
  const result = document.apply({ type: 'addNode', node: 'forbidden' })
  assert.equal(result.ok, false)
  assert.equal(result.error.message, 'No forbidden boxes')
  assert.equal(document.text, start)
  assert.equal(document.canUndo, false)
})

test('an edit that cannot apply is reported, not thrown', () => {
  const document = createDotDocument(start)
  const result = document.apply({ type: 'removeNode', node: 'missing' })
  assert.equal(result.ok, false)
  assert.ok(result.error instanceof DotEditError)
  assert.equal(document.text, start)
})

test('replacing with unreadable text is refused', () => {
  const document = createDotDocument(start)
  const result = document.replace('digraph { a -> }')
  assert.equal(result.ok, false)
  assert.ok(result.error instanceof DotSyntaxError)
  assert.equal(document.text, start)
})

test('an invalid starting text is refused', () => {
  assert.throws(() => createDotDocument('digraph {'), DotSyntaxError)
})

test('a new edit clears redo, and an unchanged result adds no history', () => {
  const document = createDotDocument(start)
  document.apply({ type: 'addNode', node: 'c' })
  document.undo()
  assert.equal(document.canRedo, true)
  document.apply({ type: 'addNode', node: 'd' })
  assert.equal(document.canRedo, false)
  assert.deepEqual(document.replace(document.text), { ok: true, changed: false })
})

test('vizValidator checks every graph and reports Graphviz errors by graph', () => {
  const fakeViz = {
    render: text =>
      text.includes('broken')
        ? { status: 'failure', errors: [{ level: 'error', message: 'syntax error in line 1 near broken' }] }
        : { status: 'success', errors: [{ level: 'warning', message: 'just a warning' }] },
  }
  const validate = vizValidator(fakeViz)
  assert.doesNotThrow(() => validate('digraph one { a }\ndigraph two { b }'))
  assert.throws(() => validate('digraph one { a }\ndigraph two { broken }'), /Graph "two": syntax error in line 1 near broken/)
})
