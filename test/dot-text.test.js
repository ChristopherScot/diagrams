import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dotRun } from './graphviz.js'
import {
  parse,
  applyEdit,
  setNodeAttr,
  setEdgeAttr,
  setGraphAttr,
  addNode,
  addEdge,
  removeNode,
  removeEdge,
  renameNode,
  addCluster,
  newClusterId,
  moveNode,
  moveCluster,
  describe,
  newNodeId,
  formatId,
  restyle,
  lineStyleOf,
  DotSyntaxError,
  DotEditError,
} from '../lib/dot-text.js'

function graphvizAccepts(text) {
  const result = dotRun(['-Tcanon'], { input: text, encoding: 'utf8' })
  if (result.error?.code === 'ENOENT') return true
  return result.status === 0 && !/warning/i.test(result.stderr)
}

function edited(text, edit) {
  const result = applyEdit(text, edit)
  assert.ok(graphvizAccepts(result), `Graphviz rejected:\n${result}`)
  return result
}

const sample = `// the checkout flow
digraph checkout {
  rankdir=LR
  cart [label="Cart"]   // where it starts
  pay [label="Pay", shape=box]
  cart -> pay [label="checkout"]
}
`

test('parse reads statements with source offsets', () => {
  const [graph] = parse(sample).graphs
  assert.equal(graph.id.value, 'checkout')
  assert.deepEqual(
    graph.body.map(item => item.type),
    ['assign', 'node', 'node', 'edge']
  )
  const edge = graph.body[3]
  assert.equal(sample.slice(edge.start, edge.end), 'cart -> pay [label="checkout"]')
})

test('parse reports the line and column of a syntax error', () => {
  assert.throws(() => parse('digraph {\n  a -> \n}'), error => {
    assert.ok(error instanceof DotSyntaxError)
    assert.equal(error.line, 3)
    return true
  })
})

test('parse rejects the wrong edge operator for the graph kind', () => {
  assert.throws(() => parse('graph { a -> b }'), DotSyntaxError)
})

test('parse handles comments, strings with escapes, html labels and ports', () => {
  const text = `digraph {
  # preprocessor line
  a [label="say \\"hi\\" {not a brace}"] /* block } comment */
  b [label=<<b>bold</b>>]
  a:out:e -> b:in
  "multi" + "part" -> c
}`
  const model = describe(text)
  assert.equal(model.nodes.get('a').attrs.label, 'say "hi" {not a brace}')
  assert.deepEqual(model.nodes.get('b').attrs.label, { html: '<b>bold</b>' })
  assert.ok(model.nodes.has('multipart'))
  assert.deepEqual(
    model.edges.map(edge => `${edge.from}>${edge.to}`),
    ['a>b', 'multipart>c']
  )
})

test('setNodeAttr replaces a value in place and keeps everything else', () => {
  const result = edited(sample, { type: 'setNodeAttr', node: 'cart', key: 'label', value: 'Basket' })
  assert.equal(result, sample.replace('label="Cart"', 'label=Basket'))
})

test('setNodeAttr quotes values that need it', () => {
  const result = setNodeAttr(sample, { node: 'cart', key: 'label', value: 'My cart' })
  assert.match(result, /cart \[label="My cart"\]   \/\/ where it starts/)
})

test('setNodeAttr appends to the existing list in its separator style', () => {
  const result = edited(sample, { type: 'setNodeAttr', node: 'pay', key: 'color', value: 'red' })
  assert.match(result, /pay \[label="Pay", shape=box, color=red\]/)
})

test('setNodeAttr adds a list to a bare declaration', () => {
  const text = 'digraph {\n  a\n  a -> b\n}\n'
  assert.equal(setNodeAttr(text, { node: 'a', key: 'shape', value: 'box' }), 'digraph {\n  a [shape=box]\n  a -> b\n}\n')
})

test('setNodeAttr declares a node that only appears in edges', () => {
  const text = 'digraph {\n  a -> b\n}\n'
  assert.equal(edited(text, { type: 'setNodeAttr', node: 'b', key: 'label', value: 'B' }), 'digraph {\n  a -> b\n  b [label=B]\n}\n')
})

test('setNodeAttr edits the declaration that wins when a node is declared twice', () => {
  const text = 'digraph {\n  a [label=one]\n  a [color=red]\n}\n'
  assert.equal(setNodeAttr(text, { node: 'a', key: 'label', value: 'two' }), 'digraph {\n  a [label=two]\n  a [color=red]\n}\n')
  assert.equal(setNodeAttr(text, { node: 'a', key: 'shape', value: 'box' }), 'digraph {\n  a [label=one]\n  a [color=red, shape=box]\n}\n')
})

test('setNodeAttr with null removes the attribute and an emptied list', () => {
  assert.match(setNodeAttr(sample, { node: 'pay', key: 'shape', value: null }), /pay \[label="Pay"\]\n/)
  assert.match(setNodeAttr(sample, { node: 'pay', key: 'label', value: null }), /pay \[shape=box\]\n/)
  assert.match(setNodeAttr(sample, { node: 'cart', key: 'label', value: null }), /\n  cart   \/\/ where it starts\n/)
})

test('setNodeAttr writes html labels', () => {
  const result = edited(sample, { type: 'setNodeAttr', node: 'cart', key: 'label', value: { html: '<i>Cart</i>' } })
  assert.match(result, /cart \[label=<<i>Cart<\/i>>\]/)
})

test('setGraphAttr updates, adds and removes graph attributes', () => {
  assert.match(edited(sample, { type: 'setGraphAttr', key: 'rankdir', value: 'TB' }), /\n  rankdir=TB\n/)
  assert.match(edited(sample, { type: 'setGraphAttr', key: 'label', value: 'Checkout' }), /checkout \{\n  label=Checkout\n  rankdir=LR/)
  assert.doesNotMatch(setGraphAttr(sample, { key: 'rankdir', value: null }), /rankdir/)
})

test('setGraphAttr edits a graph [ ] statement and a subgraph', () => {
  const text = 'digraph {\n  graph [label=x]\n  subgraph cluster_a {\n    label=A\n    a\n  }\n}\n'
  assert.match(setGraphAttr(text, { key: 'label', value: 'y' }), /graph \[label=y\]/)
  assert.match(edited(text, { type: 'setGraphAttr', subgraph: 'cluster_a', key: 'label', value: 'Area' }), /    label=Area\n/)
})

test('setEdgeAttr edits a single edge in place', () => {
  const result = edited(sample, { type: 'setEdgeAttr', edge: { from: 'cart', to: 'pay' }, key: 'label', value: 'buy' })
  assert.match(result, /cart -> pay \[label=buy\]/)
})

test('setEdgeAttr splits a chain so only one link changes', () => {
  const text = 'digraph {\n  a -> b -> c [color=gray]\n}\n'
  const result = edited(text, { type: 'setEdgeAttr', edge: { from: 'b', to: 'c' }, key: 'color', value: 'red' })
  assert.equal(result, 'digraph {\n  a -> b [color=gray]\n  b -> c [color=red]\n}\n')
})

test('edges between the same nodes are told apart by index', () => {
  const text = 'digraph {\n  a -> b [label=first]\n  a -> b [label=second]\n}\n'
  const result = setEdgeAttr(text, { edge: { from: 'a', to: 'b', index: 1 }, key: 'label', value: 'two' })
  assert.equal(result, 'digraph {\n  a -> b [label=first]\n  a -> b [label=two]\n}\n')
})

test('removeEdge removes the statement and keeps endpoints that would vanish', () => {
  const text = 'digraph {\n  a -> b\n  b -> c\n}\n'
  assert.equal(edited(text, { type: 'removeEdge', edge: { from: 'b', to: 'c' } }), 'digraph {\n  a -> b\n  c\n}\n')
  assert.equal(edited(text, { type: 'removeEdge', edge: { from: 'a', to: 'b' } }), 'digraph {\n  a\n  b -> c\n}\n')
})

test('removeEdge cuts the middle of a chain', () => {
  const text = 'digraph {\n  a -> b -> c -> d\n}\n'
  assert.equal(removeEdge(text, { edge: { from: 'b', to: 'c' } }), 'digraph {\n  a -> b\n  c -> d\n}\n')
})

test('removeEdge refuses edges that come from a subgraph group', () => {
  const text = 'digraph {\n  a -> {b c}\n}\n'
  assert.throws(() => removeEdge(text, { edge: { from: 'a', to: 'b' } }), DotEditError)
})

test('removeNode removes its declarations and edges, keeping its neighbours', () => {
  const text = 'digraph {\n  a [label=A]\n  b\n  a -> b -> c\n  x -> b\n}\n'
  const result = edited(text, { type: 'removeNode', node: 'b' })
  const model = describe(result)
  assert.deepEqual([...model.nodes.keys()].sort(), ['a', 'c', 'x'])
  assert.equal(model.edges.length, 0)
  assert.match(result, /a \[label=A\]/)
})

test('removeNode works inside clusters', () => {
  const text = 'digraph {\n  subgraph cluster_x {\n    a\n    b\n  }\n  a -> b\n}\n'
  assert.equal(edited(text, { type: 'removeNode', node: 'a' }), 'digraph {\n  subgraph cluster_x {\n    b\n  }\n}\n')
})

test('addNode and addEdge append at the graph indentation', () => {
  let text = addNode(sample, { node: 'done', attrs: { label: 'Done!' } })
  text = edited(text, { type: 'addEdge', from: 'pay', to: 'done' })
  assert.match(text, /\n  done \[label="Done!"\]\n  pay -> done\n\}\n$/)
})

test('addNode can target a cluster and refuses duplicates', () => {
  const text = 'digraph {\n  subgraph cluster_x {\n    a\n  }\n}\n'
  assert.equal(addNode(text, { subgraph: 'cluster_x', node: 'b' }), 'digraph {\n  subgraph cluster_x {\n    a\n    b\n  }\n}\n')
  assert.throws(() => addNode(text, { node: 'a' }), DotEditError)
})

test('addEdge uses -- in an undirected graph and works on one-line graphs', () => {
  assert.equal(addEdge('graph {a}', { from: 'a', to: 'b' }), 'graph {a\n  a -- b\n}')
})

test('renameNode renames declarations and edge ends, not attribute values', () => {
  const text = 'digraph {\n  a [label=a]\n  a -> b\n  b -> a:e\n}\n'
  assert.equal(edited(text, { type: 'renameNode', node: 'a', to: 'start here' }), 'digraph {\n  "start here" [label=a]\n  "start here" -> b\n  b -> "start here":e\n}\n')
  assert.throws(() => renameNode(text, { node: 'a', to: 'b' }), DotEditError)
})

test('edits target a named graph in a multi-graph file', () => {
  const text = 'digraph one {\n  a\n}\ndigraph two {\n  a\n}\n'
  const result = setNodeAttr(text, { graph: 'two', node: 'a', key: 'shape', value: 'box' })
  assert.equal(result, 'digraph one {\n  a\n}\ndigraph two {\n  a [shape=box]\n}\n')
})

test('batch applies edits in order', () => {
  const result = edited(sample, {
    type: 'batch',
    edits: [
      { type: 'addNode', node: 'node1', attrs: { label: 'New' } },
      { type: 'addEdge', from: 'pay', to: 'node1' },
    ],
  })
  assert.equal(describe(result).edges.at(-1).to, 'node1')
})

test('describe and newNodeId report the graph for a canvas', () => {
  const model = describe(sample)
  assert.equal(model.id, 'checkout')
  assert.equal(model.attrs.rankdir, 'LR')
  assert.deepEqual(model.edges[0], { from: 'cart', to: 'pay', index: 0, attrs: { label: 'checkout' }, editable: true })
  assert.equal(newNodeId('digraph { new_node new_node_2 }'), 'new_node_3')
})

test('formatId quotes keywords and non-identifiers', () => {
  assert.equal(formatId('abc_1'), 'abc_1')
  assert.equal(formatId('Node'), '"Node"')
  assert.equal(formatId('a b'), '"a b"')
  assert.equal(formatId('-1.5'), '-1.5')
})

test('describe reports node and edge defaults', () => {
  const model = describe('digraph {\n  node [shape=box, style="rounded,filled"]\n  edge [color=gray]\n  a -> b\n}')
  assert.deepEqual(model.defaults, { node: { shape: 'box', style: 'rounded,filled' }, edge: { color: 'gray' } })
})

test('restyle swaps the line style and keeps other style words', () => {
  assert.equal(restyle('rounded,filled', { line: 'dashed' }), 'rounded,filled,dashed')
  assert.equal(restyle('rounded, dotted ,filled', { line: 'bold' }), 'rounded,filled,bold')
  assert.equal(restyle('dashed', { line: 'solid' }), '')
  assert.equal(restyle('rounded', { filled: true }), 'rounded,filled')
  assert.equal(restyle('', { line: 'dotted', filled: true }), 'dotted,filled')
  assert.equal(lineStyleOf('rounded,filled,dashed'), 'dashed')
  assert.equal(lineStyleOf(undefined), 'solid')
})

const shop = `digraph {
  node [shape=box]
  subgraph cluster_store {
    label="Store"
    cart [label="Cart"]
    pay [label="Payment"]
  }
  done [label="Done"]
  cart -> pay
  pay -> done
}
`

test('addCluster wraps nodes at the same level in a new box', () => {
  const text = 'digraph {\n  a [label=A]\n  b\n  a -> b\n}\n'
  const result = edited(text, { type: 'addCluster', cluster: 'cluster_1', nodes: ['a', 'b'], attrs: { label: 'New box' } })
  assert.equal(result, 'digraph {\n  a [label=A]\n  b\n  a -> b\n  subgraph cluster_1 {\n    label="New box"\n    a\n    b\n  }\n}\n')
})

test('addCluster nests the new box inside the box its nodes share', () => {
  const result = edited(shop, { type: 'addCluster', cluster: 'cluster_1', nodes: ['cart'] })
  assert.match(result, /    pay \[label="Payment"\]\n    subgraph cluster_1 \{\n      cart\n    \}\n  \}\n/)
})

test('addCluster moves a node declared in another box into the new box', () => {
  const result = edited(shop, { type: 'addCluster', cluster: 'cluster_1', nodes: ['pay', 'done'], attrs: { label: 'Finish' } })
  assert.doesNotMatch(result.slice(0, result.indexOf('done [label')), /pay \[label/)
  assert.match(result, /  subgraph cluster_1 \{\n    label=Finish\n    pay \[label="Payment"\]\n    done\n  \}\n\}\n$/)
})

test('addCluster lifts a connection out of the box a node leaves', () => {
  const text = 'digraph {\n  subgraph cluster_a {\n    x -> y\n  }\n  z\n}\n'
  const result = edited(text, { type: 'addCluster', cluster: 'cluster_1', nodes: ['x', 'z'] })
  assert.equal(result, 'digraph {\n  subgraph cluster_a {\n    y\n  }\n  z\n  subgraph cluster_1 {\n    x\n    z\n  }\n  x -> y\n}\n')
})

test('moveNode puts a top-level node into a box', () => {
  const result = edited(shop, { type: 'moveNode', node: 'done', to: 'cluster_store' })
  assert.match(result, /    pay \[label="Payment"\]\n    done\n  \}/)
  assert.equal(describe(result).nodes.get('done').cluster, 'cluster_store')
})

test('moveNode takes a node out of its box with its attributes', () => {
  const result = edited(shop, { type: 'moveNode', node: 'cart', to: null })
  assert.doesNotMatch(result.slice(result.indexOf('cluster_store'), result.indexOf('done [')), /cart/)
  assert.match(result, /  pay -> done\n  cart \[label="Cart"\]\n\}\n$/)
  assert.equal(describe(result).nodes.get('cart').cluster, null)
})

test('moveNode lifts connections written inside the old box and keeps the other end there', () => {
  const text = 'digraph {\n  subgraph cluster_a {\n    x -> y [label=go]\n  }\n  subgraph cluster_b {\n    z\n  }\n}\n'
  const result = edited(text, { type: 'moveNode', node: 'x', to: 'cluster_b' })
  assert.equal(result, 'digraph {\n  subgraph cluster_a {\n    y\n  }\n  subgraph cluster_b {\n    z\n    x\n  }\n  x -> y [label=go]\n}\n')
  const model = describe(result)
  assert.equal(model.nodes.get('x').cluster, 'cluster_b')
  assert.equal(model.nodes.get('y').cluster, 'cluster_a')
})

test('moveNode into a nested box and back out to its parent', () => {
  const text = 'digraph {\n  subgraph cluster_outer {\n    a [color=red]\n    subgraph cluster_inner {\n      b\n    }\n  }\n}\n'
  const inside = edited(text, { type: 'moveNode', node: 'a', to: 'cluster_inner' })
  assert.equal(describe(inside).nodes.get('a').cluster, 'cluster_inner')
  const back = edited(inside, { type: 'moveNode', node: 'a', to: 'cluster_outer' })
  assert.equal(describe(back).nodes.get('a').cluster, 'cluster_outer')
  assert.match(back, /a \[color=red\]/)
})

test('moveNode to the box it is already in changes nothing, and unknown boxes are refused', () => {
  assert.equal(moveNode(shop, { node: 'cart', to: 'cluster_store' }), shop)
  assert.equal(moveNode(shop, { node: 'done', to: null }), shop)
  assert.throws(() => moveNode(shop, { node: 'done', to: 'cluster_nope' }), /There is no box named/)
})

test('addCluster refuses a taken name and missing nodes', () => {
  assert.throws(() => addCluster(shop, { cluster: 'cluster_store', nodes: ['done'] }), DotEditError)
  assert.throws(() => addCluster(shop, { cluster: 'cluster_1', nodes: ['ghost'] }), DotEditError)
  assert.equal(newClusterId(shop), 'cluster_1')
})

test('addEdge links a node to a box through an invisible anchor', () => {
  const result = edited(shop, { type: 'addEdge', from: 'done', to: { cluster: 'cluster_store' } })
  assert.match(result, /^digraph \{\n  compound=true\n/)
  assert.match(result, /    cluster_store_anchor \[shape=point, style=invis, width=0, height=0, label=""\]\n  \}/)
  assert.match(result, /  done -> cluster_store_anchor \[lhead=cluster_store\]\n\}\n$/)
})

test('addEdge links from a box, between boxes, and reuses the anchor', () => {
  const text = 'digraph {\n  subgraph cluster_a {\n    a\n  }\n  subgraph cluster_b {\n    b\n  }\n}\n'
  let result = edited(text, { type: 'addEdge', from: { cluster: 'cluster_a' }, to: 'b' })
  assert.match(result, /cluster_a_anchor -> b \[ltail=cluster_a\]/)
  result = edited(result, { type: 'addEdge', from: { cluster: 'cluster_a' }, to: { cluster: 'cluster_b' }, attrs: { label: 'then' } })
  assert.match(result, /cluster_a_anchor -> cluster_b_anchor \[ltail=cluster_a, lhead=cluster_b, label=then\]/)
  assert.equal((result.match(/cluster_a_anchor \[/g) || []).length, 1)
  assert.equal((result.match(/compound=true/g) || []).length, 1)
})

test('addEdge refuses to link a box to itself or to something inside it', () => {
  assert.throws(() => addEdge(shop, { from: { cluster: 'cluster_store' }, to: 'cart' }), /inside it/)
  assert.throws(() => addEdge(shop, { from: 'pay', to: { cluster: 'cluster_store' } }), /inside it/)
  assert.throws(() => addEdge(shop, { from: { cluster: 'cluster_store' }, to: { cluster: 'cluster_store' } }), /itself/)
  const nested = 'digraph {\n  subgraph cluster_out {\n    a\n    subgraph cluster_in {\n      b\n    }\n  }\n}\n'
  assert.throws(() => addEdge(nested, { from: { cluster: 'cluster_out' }, to: { cluster: 'cluster_in' } }), DotEditError)
})

const nest = `digraph {
  subgraph cluster_a {
    label=A
    a1 [color=red]
    a1 -> a2
  }
  subgraph cluster_b {
    label=B
    b1
  }
  c
  a2 -> b1
}
`

test('moveCluster puts a box inside another box with its contents', () => {
  const result = edited(nest, { type: 'moveCluster', cluster: 'cluster_a', to: 'cluster_b' })
  assert.match(result, /  subgraph cluster_b \{\n    label=B\n    b1\n    subgraph cluster_a \{\n      label=A\n      a1 \[color=red\]\n      a1 -> a2\n    \}\n  \}\n/)
  const model = describe(result)
  assert.equal(model.subgraphs.get('cluster_a').parent, 'cluster_b')
  assert.equal(model.nodes.get('a1').cluster, 'cluster_a')
  assert.equal(model.nodes.get('b1').cluster, 'cluster_b')
})

test('moveCluster takes a nested box back out to the top level', () => {
  const inside = edited(nest, { type: 'moveCluster', cluster: 'cluster_a', to: 'cluster_b' })
  const out = edited(inside, { type: 'moveCluster', cluster: 'cluster_a', to: null })
  const model = describe(out)
  assert.equal(model.subgraphs.get('cluster_a').parent, null)
  assert.equal(model.nodes.get('a2').cluster, 'cluster_a')
  assert.equal(model.nodes.get('b1').cluster, 'cluster_b')
})

test('moveCluster lifts connections in the old parent that would keep its nodes there', () => {
  const text = 'digraph {\n  subgraph cluster_p {\n    subgraph cluster_c {\n      x\n    }\n    y\n    x -> y\n  }\n}\n'
  const result = edited(text, { type: 'moveCluster', cluster: 'cluster_c', to: null })
  const model = describe(result)
  assert.equal(model.nodes.get('x').cluster, 'cluster_c')
  assert.equal(model.nodes.get('y').cluster, 'cluster_p')
  assert.equal(model.subgraphs.get('cluster_c').parent, null)
})

test('moveCluster refuses to put a box inside itself or its own boxes, and does nothing when already there', () => {
  const inside = moveCluster(nest, { cluster: 'cluster_a', to: 'cluster_b' })
  assert.throws(() => moveCluster(inside, { cluster: 'cluster_b', to: 'cluster_a' }), /inside itself/)
  assert.throws(() => moveCluster(nest, { cluster: 'cluster_a', to: 'cluster_a' }), /inside itself/)
  assert.equal(moveCluster(nest, { cluster: 'cluster_a', to: null }), nest)
})

test('addCluster wraps whole boxes and loose nodes in a new box', () => {
  const result = edited(nest, { type: 'addCluster', cluster: 'cluster_1', clusters: ['cluster_a', 'cluster_b'], nodes: ['c'], attrs: { label: 'All' } })
  const model = describe(result)
  assert.equal(model.subgraphs.get('cluster_a').parent, 'cluster_1')
  assert.equal(model.subgraphs.get('cluster_b').parent, 'cluster_1')
  assert.equal(model.nodes.get('c').cluster, 'cluster_1')
  assert.equal(model.nodes.get('a1').cluster, 'cluster_a')
  assert.equal(model.subgraphs.get('cluster_1').parent, null)
})

test('addCluster with nothing in it makes an empty box Graphviz still draws', () => {
  const result = edited('digraph {\n  a\n}\n', { type: 'addCluster', cluster: 'cluster_1', attrs: { label: 'New box' } })
  assert.equal(result, 'digraph {\n  a\n  subgraph cluster_1 {\n    label="New box"\n    cluster_1_anchor [shape=point, style=invis, width=0, height=0, label=""]\n  }\n}\n')
  assert.match(dotRun(['-Tsvg'], { input: result, encoding: 'utf8' }).stdout, /<title>cluster_1<\/title>/)
  const nested = edited(shop, { type: 'addCluster', cluster: 'cluster_1', subgraph: 'cluster_store' })
  assert.equal(describe(nested).subgraphs.get('cluster_1').parent, 'cluster_store')
})

test('moving a node into an empty box keeps working with its anchor', () => {
  const empty = addCluster('digraph {\n  a\n}\n', { cluster: 'cluster_1' })
  const result = edited(empty, { type: 'moveNode', node: 'a', to: 'cluster_1' })
  assert.equal(describe(result).nodes.get('a').cluster, 'cluster_1')
})
