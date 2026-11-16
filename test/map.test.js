import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { dotRun } from './graphviz.js'
import { applyEdit, describe, clusterToView, DotEditError } from '../lib/dot-text.js'
import { wholeMap, routeMapEdit, viewRules, mapNodeId } from '../lib/dot-views.js'

const examplePath = join(homedir(), '.claude/skills/drilldown-diagrams/example.dot')
const example = existsSync(examplePath) ? readFileSync(examplePath, 'utf8') : null

function graphviz(text) {
  const result = dotRun(['-Tcanon'], { input: text, encoding: 'utf8' })
  if (result.error?.code === 'ENOENT') return
  assert.equal(result.status, 0, result.stderr)
}

const checkout = `digraph checkout {
  title="Checkout"
  subgraph cluster_store {
    label="Store"
    cart [label="Cart"]
    pay [label="Payment"]
  }
  done [label="Order placed"]
  cart -> pay
  pay -> done
}
`
const split = clusterToView(checkout, { cluster: 'cluster_store' })

test('the map opens linked views as groups, level by level', () => {
  const top = wholeMap(split, { root: 'checkout', depth: 0 })
  assert.deepEqual(top.expanded, ['checkout'])
  assert.match(top.dot, /"checkout::store" \[label="Store" URL="#store"\]/)
  const all = wholeMap(split, { root: 'checkout' })
  assert.deepEqual(all.expanded, ['checkout', 'store'])
  assert.match(all.dot, /subgraph "cluster_v_store" \{\n    label="Store"/)
  assert.ok(!all.owners.nodes.has(mapNodeId('checkout', 'store')))
  graphviz(all.dot)
})

test('ghosts merge into their home node when it is drawn', () => {
  const all = wholeMap(split, { root: 'checkout' })
  assert.ok(all.owners.nodes.has('checkout::done'))
  assert.ok(!all.owners.nodes.has('store::done'))
  assert.ok(all.owners.edges.some(edge => edge.to === 'checkout::done'))
})

test('a branch can be opened or closed on its own', () => {
  const closed = wholeMap(split, { root: 'checkout', overrides: new Map([['store', false]]) })
  assert.deepEqual(closed.expanded, ['checkout'])
  const opened = wholeMap(split, { root: 'checkout', depth: 0, overrides: new Map([['store', true]]) })
  assert.deepEqual(opened.expanded, ['checkout', 'store'])
})

test('the skill example maps at every depth and Graphviz draws it', { skip: example == null }, () => {
  for (const depth of [0, 1, 2, Number.POSITIVE_INFINITY]) graphviz(wholeMap(example, { root: 'system', depth }).dot)
  const all = wholeMap(example, { root: 'system' })
  assert.deepEqual(all.expanded.sort(), ['catalog', 'enrollment', 'enrollment-lifecycle', 'events', 'scheduling', 'system'])
  assert.ok(all.owners.nodes.has('scheduling::section'))
  assert.ok(!all.owners.nodes.has('catalog::section'))
})

test('edits on the map go to the view that owns the thing', () => {
  const map = wholeMap(split, { root: 'checkout' })
  const rename = routeMapEdit(split, map, { type: 'setNodeAttr', graph: 'whole-map', node: 'store::cart', key: 'label', value: 'Basket' })
  assert.deepEqual(rename, { type: 'setNodeAttr', graph: 'store', node: 'cart', key: 'label', value: 'Basket' })
  const arrow = routeMapEdit(split, map, { type: 'setEdgeAttr', edge: { from: 'store::cart', to: 'store::pay', index: 0 }, key: 'style', value: 'dashed' })
  assert.equal(arrow.graph, 'store')
  const group = routeMapEdit(split, map, { type: 'setGraphAttr', subgraph: 'cluster_v_store', key: 'label', value: 'Shop' })
  assert.deepEqual([group.graph, group.key, group.value], ['store', 'title', 'Shop'])
})

test('a connection across views lives in the target view, with the source coming in as a ghost', () => {
  const map = wholeMap(split, { root: 'checkout' })
  const add = routeMapEdit(split, map, { type: 'addEdge', from: 'checkout::done', to: 'store::cart' })
  const result = applyEdit(split, add)
  viewRules(result)
  graphviz(result)
  const home = describe(result, { graph: 'store' })
  assert.deepEqual(home.nodes.get('done').attrs, { label: 'Order placed', class: 'ghost', URL: '#checkout' })
  assert.ok(home.edges.some(edge => edge.from === 'done' && edge.to === 'cart'))
  const again = wholeMap(result, { root: 'checkout' })
  assert.ok(again.owners.edges.some(edge => edge.from === 'checkout::done' && edge.to === 'store::cart'))
})

test('boxes spanning views are refused', () => {
  const map = wholeMap(split, { root: 'checkout' })
  assert.throws(() => routeMapEdit(split, map, { type: 'addCluster', cluster: 'cluster_1', nodes: ['checkout::done', 'store::cart'] }), /different views/)
  const box = routeMapEdit(split, map, { type: 'addCluster', cluster: 'cluster_1', nodes: ['store::cart', 'store::pay'] })
  assert.equal(box.graph, 'store')
})

test('a summary arrow from a closed view is dropped when the opened view shows the detail', () => {
  const ghosted = clusterToView(`digraph checkout {
  subgraph cluster_store {
    label="Store"
    pay
  }
  start
  start -> pay [label=shop]
}
`, { cluster: 'cluster_store' })
  const open = wholeMap(ghosted, { root: 'checkout' })
  assert.deepEqual(open.owners.edges.map(edge => `${edge.from}>${edge.to}`), ['checkout::start>store::pay'])
  const closed = wholeMap(ghosted, { root: 'checkout', depth: 0 })
  assert.deepEqual(closed.owners.edges.map(edge => `${edge.from}>${edge.to}`), ['checkout::start>checkout::store'])
})

test('new node ids are unique across views, unrelated look-alikes are not copies, and id clashes are refused', async () => {
  const { newNodeId, addView, setLink } = await import('../lib/dot-text.js')
  const { copiesOf } = await import('../lib/dot-views.js')
  let s = 'digraph checkout {\n  a\n  b\n}\n'
  s = setLink(addView(s, { view: 'one', title: 'One', parent: 'checkout' }), { graph: 'checkout', node: 'a', view: 'one' })
  s = setLink(addView(s, { view: 'two', title: 'Two', parent: 'checkout' }), { graph: 'checkout', node: 'b', view: 'two' })
  s = applyEdit(s, { type: 'addNode', graph: 'one', node: newNodeId(s), attrs: { label: 'New node' } })
  s = applyEdit(s, { type: 'addNode', graph: 'two', node: newNodeId(s), attrs: { label: 'New node' } })
  assert.deepEqual([...describe(s, { graph: 'one' }).nodes.keys()], ['new_node'])
  assert.deepEqual([...describe(s, { graph: 'two' }).nodes.keys()], ['new_node_2'])

  const clash = s.replace('new_node_2 [label="New node"]', 'new_node [label="New node"]')
  assert.deepEqual(copiesOf(clash, 'one', 'new_node'), [])
  const map = wholeMap(clash, { root: 'checkout' })
  assert.throws(() => routeMapEdit(clash, map, { type: 'addEdge', from: 'one::new_node', to: 'two::new_node' }), /already has its own node/)

  const linked = applyEdit(s, routeMapEdit(s, wholeMap(s, { root: 'checkout' }), { type: 'addEdge', from: 'one::new_node', to: 'two::new_node_2' }))
  assert.deepEqual(copiesOf(linked, 'one', 'new_node').map(copy => copy.view), ['two'])
  assert.deepEqual(copiesOf(linked, 'two', 'new_node').map(copy => copy.view), ['one'])
})

test('a new connected node made on the map lands in its source node\'s view', () => {
  const text = `digraph top { title="Top" a [label=A URL="#child"] }
digraph child { title="Child" parent=top x [label=X] }`
  const map = wholeMap(text, { root: 'top' })
  const routed = routeMapEdit(text, map, {
    type: 'batch',
    edits: [
      { type: 'addNode', node: 'node1', attrs: { label: 'New node' } },
      { type: 'addEdge', from: 'child::x', to: 'node1' },
    ],
  })
  assert.deepEqual(routed.edits.map(edit => [edit.type, edit.graph]), [['addNode', 'child'], ['addEdge', 'child']])
  assert.equal(routed.edits[1].to, routed.edits[0].node)
})

test('a node dropped into another view on the map moves there, bringing its incoming arrows with a ghost of their source', () => {
  const text = `digraph top {
  title="Top"
  a [label=A, URL="#child"]
  b [label=B, class=blue]
  c [label=C]
  c -> b [label=feeds]
  b -> a
}
digraph child {
  title="Child"
  parent=top
  x [label=X]
}
`
  const map = wholeMap(text, { root: 'top' })
  const group = [...map.owners.boxes].find(([, box]) => box.group && box.view === 'child')[0]
  const result = applyEdit(text, routeMapEdit(text, map, { type: 'moveNode', node: 'top::b', to: group }))
  viewRules(result)
  graphviz(result)
  const child = describe(result, { graph: 'child' })
  assert.deepEqual(child.nodes.get('b').attrs, { label: 'B', class: 'blue' })
  assert.deepEqual(child.nodes.get('c').attrs, { label: 'C', class: 'ghost', URL: '#top' })
  assert.ok(child.edges.some(edge => edge.from === 'c' && edge.to === 'b' && edge.attrs.label === 'feeds'))
  const top = describe(result, { graph: 'top' })
  assert.deepEqual(top.nodes.get('b').attrs, { label: 'B', class: 'ghost', URL: '#child' })
  assert.ok(!top.edges.some(edge => edge.from === 'c' && edge.to === 'b'))
  assert.ok(top.edges.some(edge => edge.from === 'b' && edge.to === 'a'))
})

test('connecting to a view\'s group on the map connects to the node that opens it', () => {
  const text = `digraph top {
  title="Top"
  a [label=A, URL="#child"]
  b [label=B]
}
digraph child {
  title="Child"
  parent=top
  x [label=X]
}
`
  const map = wholeMap(text, { root: 'top' })
  const group = [...map.owners.boxes].find(([, box]) => box.group && box.view === 'child')[0]
  const result = applyEdit(text, routeMapEdit(text, map, { type: 'addEdge', from: 'top::b', to: { cluster: group } }))
  viewRules(result)
  assert.ok(describe(result, { graph: 'top' }).edges.some(edge => edge.from === 'b' && edge.to === 'a'))
  assert.throws(() => routeMapEdit(text, map, { type: 'addEdge', from: 'child::x', to: { cluster: group } }), /own border/)
})

test('an opened view on the map takes the color of the node that opens it', () => {
  const text = `digraph top {
  title="Top"
  subgraph cluster_big { class=violet; label=Big; a [label=A, URL="#child", class=rose] }
}
digraph child {
  title="Child"
  parent=top
  x [label=X]
}
`
  const map = wholeMap(text, { root: 'top' })
  assert.match(map.dot, /subgraph "cluster_v_child" \{[^}]*class="?rose"?/)
  graphviz(map.dot)
})

test('a ghost of a ghost is followed to the real node on the map, repaired, and no longer created', async () => {
  const { repairGhosts } = await import('../lib/dot-views.js')
  const text = `digraph top {
  title="Top"
  b [label=B]
  mid [label=Mid, URL="#mid"]
}
digraph mid {
  title="Mid"
  parent=top
  b [label=B, class=ghost, URL="#top"]
  leaf [label=Leaf, URL="#leaf"]
  b -> leaf
}
digraph leaf {
  title="Leaf"
  parent=mid
  b [label=B, class=ghost, URL="#mid"]
  x [label=X]
  b -> x
}
`
  const map = wholeMap(text, { root: 'top' })
  assert.ok(map.owners.edges.some(edge => edge.from === 'top::b' && edge.to === 'leaf::x'))
  assert.deepEqual(repairGhosts(text).edits, [{ type: 'setNodeAttr', graph: 'leaf', node: 'b', key: 'URL', value: '#top' }])
  const boxed = applyEdit(`digraph top {
  title="Top"
  b [label=B]
  mid [label=Mid, URL="#mid"]
}
digraph mid {
  title="Mid"
  parent=top
  b [label=B, class=ghost, URL="#top"]
  subgraph cluster_leaf { label=Leaf; x [label=X] }
  b -> x
}
`, { type: 'clusterToView', graph: 'mid', cluster: 'cluster_leaf' })
  assert.equal(describe(boxed, { graph: 'leaf' }).nodes.get('b').attrs.URL, '#top')
})
