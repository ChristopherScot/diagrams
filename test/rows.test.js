import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dotRun } from './graphviz.js'
import { applyEdit, describe, placeInRow, leaveRow, removeNode, DotEditError } from '../lib/dot-text.js'

function graphviz(text) {
  const result = dotRun(['-Tplain'], { input: text, encoding: 'utf8' })
  if (result.error?.code === 'ENOENT') return null
  assert.equal(result.status, 0, result.stderr)
  assert.doesNotMatch(result.stderr, /warning/i, result.stderr)
  const positions = {}
  for (const line of result.stdout.split('\n')) {
    const [kind, name, x, y] = line.split(' ')
    if (kind === 'node') positions[name] = { x: Number(x), y: Number(y) }
  }
  return positions
}

const fan = 'digraph {\n  a -> b\n  a -> c\n  a -> d\n}\n'

test('placeInRow before a node puts both in a row in that order', () => {
  const result = applyEdit(fan, { type: 'placeInRow', node: 'd', target: 'b', position: 'before' })
  assert.equal(result, 'digraph {\n  a -> b\n  a -> c\n  a -> d\n  subgraph row_1 {\n    rank=same\n    d -> b [style=invis]\n  }\n}\n')
  const at = graphviz(result)
  if (at) assert.ok(at.d.x < at.b.x && at.d.y === at.b.y, JSON.stringify(at))
})

test('placing more nodes builds one ordered row that Graphviz follows', () => {
  let text = placeInRow(fan, { node: 'd', target: 'b', position: 'before' })
  text = placeInRow(text, { node: 'c', target: 'd', position: 'before' })
  assert.deepEqual(describe(text).rows.get('row_1'), ['c', 'd', 'b'])
  const at = graphviz(text)
  if (at) assert.ok(at.c.x < at.d.x && at.d.x < at.b.x, JSON.stringify(at))
  text = placeInRow(text, { node: 'c', target: 'b', position: 'after' })
  assert.deepEqual(describe(text).rows.get('row_1'), ['d', 'b', 'c'])
})

test('in a left-to-right layout the row runs top to bottom in the same order', () => {
  const text = placeInRow('digraph {\n  rankdir=LR\n  a -> b\n  a -> c\n}\n', { node: 'c', target: 'b', position: 'before' })
  const at = graphviz(text)
  if (at) assert.ok(at.c.y > at.b.y && at.c.x === at.b.x, JSON.stringify(at))
})

test('a node moves between rows, and a row of one disappears', () => {
  const text = 'digraph {\n  a -> b\n  a -> c\n  b -> d\n  b -> e\n}\n'
  let result = placeInRow(text, { node: 'c', target: 'b' })
  result = placeInRow(result, { node: 'e', target: 'd' })
  result = placeInRow(result, { node: 'c', target: 'd' })
  const model = describe(result)
  assert.deepEqual([...model.rows.values()], [['d', 'c', 'e']])
  graphviz(result)
})

test('leaveRow takes a node out, and removing the last pair restores the text', () => {
  let text = placeInRow(fan, { node: 'd', target: 'b' })
  text = placeInRow(text, { node: 'c', target: 'b' })
  text = leaveRow(text, { node: 'b' })
  assert.deepEqual(describe(text).rows.get('row_1'), ['c', 'd'])
  text = leaveRow(text, { node: 'd' })
  assert.equal(text, fan)
  assert.equal(leaveRow(fan, { node: 'a' }), fan)
})

test('a row across a box turns on newrank so it can line up', () => {
  const text = 'digraph {\n  subgraph cluster_k {\n    s -> x\n  }\n  s -> t -> y\n}\n'
  const result = placeInRow(text, { node: 'y', target: 'x', position: 'before' })
  assert.match(result, /^digraph \{\n  newrank=true\n/)
  const at = graphviz(result)
  if (at) assert.equal(at.x.y, at.y.y)
  assert.equal(describe(result).nodes.get('x').cluster, 'cluster_k')
})

test('removing a node in the middle of a row keeps the others in order', () => {
  let text = placeInRow(fan, { node: 'c', target: 'b' })
  text = placeInRow(text, { node: 'd', target: 'c' })
  const result = removeNode(text, { node: 'c' })
  assert.deepEqual(describe(result).rows.get('row_1'), ['b', 'd'])
  assert.match(result, /b -> d \[style=invis\]/)
  graphviz(result)
})

test('placeInRow refuses a node next to itself or unknown nodes', () => {
  assert.throws(() => placeInRow(fan, { node: 'b', target: 'b' }), DotEditError)
  assert.throws(() => placeInRow(fan, { node: 'z', target: 'b' }), DotEditError)
})
