import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dotRun } from './graphviz.js'
import { resolveClasses, paletteClass, DEFAULT_PALETTE } from '../lib/palette.js'
import { describe } from '../lib/dot-text.js'

test('every skill built-in class is in the palette', () => {
  assert.deepEqual(DEFAULT_PALETTE.map(entry => entry.class), ['blue', 'green', 'amber', 'violet', 'rose', 'slate'])
  assert.equal(paletteClass(DEFAULT_PALETTE, 'drill amber').name, 'Amber')
  assert.equal(paletteClass(DEFAULT_PALETTE, 'ghost'), null)
})

test('resolveClasses gives classed nodes their fill and outline for drawing', () => {
  const model = describe(resolveClasses('digraph {\n  a [class=blue]\n  b\n  a -> b\n}\n'))
  assert.equal(model.nodes.get('a').attrs.fillcolor, '#e9edfc')
  assert.equal(model.nodes.get('a').attrs.color, '#5a6fd8')
  assert.equal(model.nodes.get('b').attrs.fillcolor, undefined)
})

test('one-off colors win over the class', () => {
  const model = describe(resolveClasses('digraph {\n  a [class=blue, color=red]\n}\n'))
  assert.equal(model.nodes.get('a').attrs.color, 'red')
  assert.equal(model.nodes.get('a').attrs.fillcolor, '#e9edfc')
})

test('classed arrows, chain links and boxes are resolved, groups are left alone', () => {
  const text = 'digraph {\n  a -> b -> c [class=rose]\n  x -> {y z} [class=green]\n  subgraph cluster_k {\n    class=amber\n    a\n  }\n}\n'
  const result = resolveClasses(text)
  const model = describe(result)
  assert.ok(model.edges.filter(edge => edge.from !== 'x').every(edge => edge.attrs.color === '#c94c6e'))
  assert.equal(model.subgraphs.get('cluster_k').attrs.color, '#c4862a')
  assert.equal(model.subgraphs.get('cluster_k').attrs.bgcolor, '#fbefdc')
  const run = dotRun(['-Tsvg'], { input: result, encoding: 'utf8' })
  if (!run.error) assert.equal(run.status, 0, run.stderr)
})

test('the skill domain-map style of model resolves in every graph of a file', () => {
  const text = 'digraph one {\n  a [class=green]\n}\ndigraph two {\n  b [class=violet]\n}\n'
  const result = resolveClasses(text)
  assert.equal(describe(result, { graph: 'two' }).nodes.get('b').attrs.fillcolor, '#f0e9fb')
})
