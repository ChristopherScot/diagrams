import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dotRun } from './graphviz.js'
import { applyEdit, describe, addView, removeView, renameView, setLink, clusterToView, viewIdFor, DotEditError } from '../lib/dot-text.js'
import { views, ancestry, viewText, viewRules, expandEdit, ViewRuleError } from '../lib/dot-views.js'

function graphvizAccepts(text) {
  const result = dotRun(['-Tcanon'], { input: text, encoding: 'utf8' })
  if (result.error?.code === 'ENOENT') return
  assert.equal(result.status, 0, result.stderr)
  assert.doesNotMatch(result.stderr, /warning/i, result.stderr)
}

function valid(text) {
  viewRules(text)
  graphvizAccepts(text)
  return text
}

const checkout = `digraph checkout {
  title="Checkout"
  rankdir=LR

  subgraph cluster_store {
    label="Store"
    style=dashed
    class=blue
    cart [label="Cart"]
    pay [label="Payment"]
  }
  done [label="Order placed"]
  start

  cart -> pay [label="checkout"]
  pay -> done [label="paid"]
  start -> cart
  start -> pay
}
`

test('turning a box into a view collapses it into one linked node', () => {
  const result = valid(applyEdit(checkout, { type: 'clusterToView', cluster: 'cluster_store' }))
  const list = views(result)
  assert.deepEqual(list.map(view => [view.id, view.title, view.parent]), [['checkout', 'Checkout', null], ['store', 'Store', 'checkout']])
  const parent = describe(result, { graph: 'checkout' })
  assert.deepEqual([...parent.nodes.keys()].sort(), ['done', 'start', 'store'])
  assert.deepEqual(parent.nodes.get('store').attrs, { label: 'Store', URL: '#store', class: 'blue' })
  assert.deepEqual(parent.edges.map(edge => `${edge.from}>${edge.to}`).sort(), ['start>store', 'store>done'])
})

test('arrows coming into the box are kept in the new view with ghosts of where they come from; arrows going out are not', () => {
  const result = clusterToView(checkout, { cluster: 'cluster_store' })
  const inside = describe(result, { graph: 'store' })
  assert.ok(!inside.nodes.has('done'))
  assert.deepEqual(inside.nodes.get('start').attrs, { class: 'ghost', URL: '#checkout' })
  assert.deepEqual(inside.edges.map(edge => `${edge.from}>${edge.to}`).sort(), ['cart>pay', 'start>cart', 'start>pay'])
  const plain = clusterToView(checkout, { cluster: 'cluster_store', ghosts: false })
  assert.deepEqual([...describe(plain, { graph: 'store' }).nodes.keys()].sort(), ['cart', 'pay'])
})

test('a link to the box becomes an arrow to the new node', () => {
  let text = applyEdit(checkout, { type: 'addEdge', from: 'done', to: { cluster: 'cluster_store' } })
  text = valid(clusterToView(text, { cluster: 'cluster_store' }))
  const parent = describe(text, { graph: 'checkout' })
  assert.ok(parent.edges.some(edge => edge.from === 'done' && edge.to === 'store' && edge.attrs.lhead == null))
  assert.ok(!parent.nodes.has('cluster_store_anchor'))
})

test('a box nested in another box becomes a node inside that box, and nodes declared elsewhere move too', () => {
  const text = 'digraph main {\n  subgraph cluster_outer {\n    label=Outer\n    subgraph cluster_inner {\n      label=Inner\n      a\n    }\n    b\n  }\n  a [color=red]\n  a -> b\n}\n'
  const result = valid(clusterToView(text, { cluster: 'cluster_inner' }))
  const parent = describe(result, { graph: 'main' })
  assert.equal(parent.nodes.get('inner').cluster, 'cluster_outer')
  assert.ok(!parent.nodes.has('a'))
  assert.equal(describe(result, { graph: 'inner' }).nodes.get('a').attrs.color, 'red')
})

test('views can be added, linked, renamed and removed without leaving dangling links', () => {
  let text = valid(addView(checkout, { view: 'payments', title: 'Payments', parent: 'checkout' }))
  text = valid(setLink(text, { graph: 'checkout', node: 'pay', view: 'payments' }))
  assert.equal(describe(text, { graph: 'checkout' }).nodes.get('pay').attrs.URL, '#payments')
  text = valid(renameView(text, { view: 'payments', to: 'billing' }))
  assert.equal(describe(text, { graph: 'checkout' }).nodes.get('pay').attrs.URL, '#billing')
  assert.equal(describe(text, { graph: 'billing' }).attrs.parent, 'checkout')
  text = valid(removeView(text, { view: 'billing' }))
  assert.equal(text, checkout)
})

test('removing a view moves its children up a level', () => {
  let text = addView(checkout, { view: 'middle', title: 'Middle', parent: 'checkout' })
  text = addView(text, { view: 'leaf', title: 'Leaf', parent: 'middle' })
  text = valid(removeView(text, { view: 'middle' }))
  assert.equal(views(text).find(view => view.id === 'leaf').parent, 'checkout')
})

test('view ids are checked and made unique from titles', () => {
  assert.throws(() => addView(checkout, { view: 'Bad Id' }), DotEditError)
  assert.throws(() => addView(checkout, { view: 'checkout' }), DotEditError)
  assert.throws(() => addView(checkout, { view: 'x', parent: 'missing' }), DotEditError)
  assert.equal(viewIdFor(checkout, 'Checkout'), 'checkout-2')
  assert.equal(viewIdFor(checkout, 'Order placed\\nnow'), 'order-placed')
})

test('viewRules rejects dangling links and parents, bad ids and loops', () => {
  assert.throws(() => viewRules('digraph a {\n  x [URL="#nope"]\n}\n'), /doesn't exist/)
  assert.throws(() => viewRules('digraph a {\n  parent=nope\n}\n'), /doesn't exist/)
  assert.throws(() => viewRules('digraph Bad_Id {\n}\n'), ViewRuleError)
  assert.throws(() => viewRules('digraph a {\n  parent=b\n}\ndigraph b {\n  parent=a\n}\n'), /chain of parents/)
  assert.doesNotThrow(() => viewRules(clusterToView(checkout, { cluster: 'cluster_store' })))
})

test('ancestry and viewText give breadcrumbs and a single view to draw', () => {
  const text = clusterToView(checkout, { cluster: 'cluster_store' })
  assert.deepEqual(ancestry(views(text), 'store').map(view => view.title), ['Checkout', 'Store'])
  assert.match(viewText(text, 'store'), /^digraph store \{[\s\S]*\}$/)
})

test('renaming a linked node renames its view, and the other way around', () => {
  const text = clusterToView(checkout, { cluster: 'cluster_store' })
  const rename = expandEdit(text, { type: 'setNodeAttr', graph: 'checkout', node: 'store', key: 'label', value: 'Shop' })
  const renamed = applyEdit(text, rename)
  assert.equal(views(renamed).find(view => view.id === 'store').title, 'Shop')
  const retitle = expandEdit(renamed, { type: 'setGraphAttr', graph: 'store', key: 'title', value: 'Basket' })
  const retitled = applyEdit(renamed, retitle)
  assert.equal(describe(retitled, { graph: 'checkout' }).nodes.get('store').attrs.label, 'Basket')
})

test('addGhost shows a node from another view, linked home', () => {
  const text = clusterToView(checkout, { cluster: 'cluster_store', ghosts: false })
  const result = valid(applyEdit(text, { type: 'addGhost', graph: 'checkout', node: 'cart', from: 'store' }))
  assert.deepEqual(describe(result, { graph: 'checkout' }).nodes.get('cart').attrs, { label: 'Cart', class: 'ghost', URL: '#store' })
  assert.throws(() => applyEdit(result, { type: 'addGhost', graph: 'checkout', node: 'cart', from: 'store' }), /already in this view/)
  assert.throws(() => applyEdit(text, { type: 'addGhost', graph: 'store', node: 'cart', from: 'store' }), /already lives/)
  const ghosted = clusterToView(checkout, { cluster: 'cluster_store' })
  assert.throws(() => applyEdit(ghosted, { type: 'addGhost', graph: 'checkout', node: 'done', from: 'store' }), DotEditError)
})

test('copiesOf finds the same node in other views, and ghostCandidates lists what can be shown', async () => {
  const { copiesOf, ghostCandidates } = await import('../lib/dot-views.js')
  const text = clusterToView(checkout, { cluster: 'cluster_store' })
  assert.deepEqual(copiesOf(text, 'checkout', 'start').map(copy => copy.view), ['store'])
  const candidates = ghostCandidates(text, 'checkout')
  assert.deepEqual(candidates.map(candidate => `${candidate.view}:${candidate.node}`).sort(), ['store:cart', 'store:pay'])
})

test('legends read and write the skill format, merging across views', async () => {
  const { parseLegend, formatLegend, legend, legendEdit, classesInUse } = await import('../lib/dot-views.js')
  assert.deepEqual(parseLegend('blue: Catalog, billing: Billing #c2410c'), [{ name: 'blue', label: 'Catalog', color: null }, { name: 'billing', label: 'Billing', color: '#c2410c' }])
  assert.deepEqual(parseLegend('blue: Catalog, things; green: Delivery').map(entry => entry.label), ['Catalog, things', 'Delivery'])
  assert.equal(formatLegend([{ name: 'blue', label: 'A, B', color: null }, { name: 'green', label: 'C', color: null }]), 'blue: A, B; green: C')

  let text = clusterToView(checkout, { cluster: 'cluster_store' })
  assert.deepEqual([...classesInUse(text)], ['blue'])
  text = applyEdit(text, legendEdit(text, 'blue', 'Catalog'))
  assert.equal(describe(text, { graph: 'checkout' }).attrs.legend, 'blue: Catalog')
  text = applyEdit(text, { type: 'setGraphAttr', graph: 'store', key: 'legend', value: 'green: Delivery' })
  text = applyEdit(text, legendEdit(text, 'green', 'Shipping'))
  assert.equal(describe(text, { graph: 'store' }).attrs.legend, 'green: Shipping')
  assert.deepEqual([...legend(text).entries()].map(([name, entry]) => `${name}=${entry.label}@${entry.view}`), ['blue=Catalog@checkout', 'green=Shipping@store'])
  text = applyEdit(text, legendEdit(text, 'blue', ''))
  assert.equal(describe(text, { graph: 'checkout' }).attrs.legend, undefined)
  valid(text)
})

test('a generated node id follows its label everywhere it appears; hand-written ids stay', async () => {
  const { renameIdsWithLabels } = await import('../lib/dot-views.js')
  const text = `digraph top {
  title="Top"
  new_node [label="New node"]
  cart [label=Cart]
  mid [label=Mid, URL="#mid"]
  new_node -> cart
}
digraph mid {
  title="Mid"
  parent=top
  new_node [label="New node", class=ghost, URL="#top"]
  x [label=X]
  new_node -> x
}
`
  const renamed = applyEdit(text, renameIdsWithLabels(text, { type: 'setNodeAttr', graph: 'top', node: 'new_node', key: 'label', value: 'Order placed' }))
  viewRules(renamed)
  assert.ok(describe(renamed, { graph: 'top' }).edges.some(edge => edge.from === 'order_placed' && edge.to === 'cart'))
  assert.ok(describe(renamed, { graph: 'mid' }).edges.some(edge => edge.from === 'order_placed' && edge.to === 'x'))
  const kept = renameIdsWithLabels(text.replace('mid [label=Mid', 'pay [label=Payment]\n  mid [label=Mid'), { type: 'setNodeAttr', graph: 'top', node: 'pay', key: 'label', value: 'Checkout' })
  assert.equal(kept.type, 'setNodeAttr')
  const clash = applyEdit(text, renameIdsWithLabels(text, { type: 'setNodeAttr', graph: 'top', node: 'new_node', key: 'label', value: 'Cart' }))
  assert.ok(describe(clash, { graph: 'top' }).nodes.has('cart_2'))
})
