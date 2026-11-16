import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyEdit, describe } from '../lib/dot-text.js'
import { lineStyleEdit, directionEdit, shapeEdit, shapeOf, colorEdit, colorOf } from '../lib/dot-style-bar.js'

const text = `digraph {
  node [shape=box, style="rounded,filled", fillcolor="#eef2ff"]
  a [label=A]
  b
  a -> b
  subgraph cluster_x {
    label=X
    c
  }
}
`

function selectNode(source, id) {
  const model = describe(source)
  return { kind: 'node', id, attrs: model.nodes.get(id).attrs, defaults: model.defaults.node, graphKind: model.kind }
}

function selectEdge(source, from, to) {
  const model = describe(source)
  const edge = model.edges.find(candidate => candidate.from === from && candidate.to === to)
  return { kind: 'edge', from, to, index: edge.index, attrs: edge.attrs, defaults: model.defaults.edge, graphKind: model.kind }
}

function selectCluster(source, id) {
  const model = describe(source)
  return { kind: 'cluster', id, attrs: model.subgraphs.get(id).attrs, defaults: {}, graphKind: model.kind }
}

test('a dashed box keeps the default rounded and filled style', () => {
  const result = applyEdit(text, lineStyleEdit(selectNode(text, 'a'), 'dashed'))
  assert.match(result, /a \[label=A, style="rounded,filled,dashed"\]/)
  const back = applyEdit(result, lineStyleEdit(selectNode(result, 'a'), 'solid'))
  assert.equal(back, text)
})

test('a dotted arrow writes only the line style', () => {
  const result = applyEdit(text, lineStyleEdit(selectEdge(text, 'a', 'b'), 'dotted'))
  assert.match(result, /a -> b \[style=dotted\]/)
  assert.equal(applyEdit(result, lineStyleEdit(selectEdge(result, 'a', 'b'), 'solid')), text)
})

test('arrow direction leaves the natural direction unwritten', () => {
  const both = applyEdit(text, directionEdit(selectEdge(text, 'a', 'b'), 'both'))
  assert.match(both, /a -> b \[dir=both\]/)
  assert.equal(applyEdit(both, directionEdit(selectEdge(both, 'a', 'b'), 'forward')), text)
})

test('shape writes only when it differs from the default shape', () => {
  const result = applyEdit(text, shapeEdit(selectNode(text, 'a'), 'diamond'))
  assert.match(result, /a \[label=A, shape=diamond\]/)
  assert.equal(applyEdit(result, shapeEdit(selectNode(result, 'a'), 'box')), text)
  assert.equal(shapeOf(selectNode('digraph { a [shape=rect] }', 'a')), 'box')
  assert.equal(shapeOf(selectNode('digraph { a }', 'a')), 'ellipse')
})

test('Color writes a class, like the skill, and Default removes it', () => {
  const blue = { name: 'Blue', class: 'blue', fill: { light: '#e9edfc' }, line: { light: '#5a6fd8' } }
  const result = applyEdit(text, colorEdit(selectNode(text, 'b'), blue))
  assert.match(result, /\n  b \[class=blue\]\n/)
  assert.equal(colorOf(selectNode(result, 'b'), [blue]), blue)
  assert.equal(applyEdit(result, colorEdit(selectNode(result, 'b'), null)), text)
  assert.equal(colorOf(selectNode(text, 'b'), [blue]), null)
})

test('Color clears one-off fill and outline so the class shows', () => {
  const green = { name: 'Green', class: 'green', fill: { light: '#e4f3e9' }, line: { light: '#3a9358' } }
  const custom = 'digraph {\n  a [fillcolor=red, color=blue, label=A]\n}\n'
  assert.equal(applyEdit(custom, colorEdit(selectNode(custom, 'a'), green)), 'digraph {\n  a [label=A, class=green, style=filled]\n}\n')
})

test('Color works on arrows and boxes too', () => {
  const green = { name: 'Green', class: 'green', fill: { light: '#e4f3e9' }, line: { light: '#3a9358' } }
  assert.match(applyEdit(text, colorEdit(selectEdge(text, 'a', 'b'), green)), /a -> b \[class=green\]/)
  assert.match(applyEdit(text, colorEdit(selectCluster(text, 'cluster_x'), green)), /    class=green\n    label=X/)
})
