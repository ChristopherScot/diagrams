import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dotRun } from './graphviz.js'
import { exportDot } from '../lib/dot-export.js'
import { DEFAULT_PALETTE } from '../lib/palette.js'

const text = `digraph checkout {
  title="Checkout"
  rankdir=LR
  subgraph cluster_store {
    label=Store
    class=violet
    cart [label=Cart, class=blue]
  }
  done [label="Order placed", fillcolor="#e4f3e9"]
  more [label=More, URL="#more"]
  cart -> done [class=rose]
}
digraph more {
  title=More
  parent=checkout
  done [label="Order placed", class=ghost, URL="#checkout"]
  x [label=X]
  done -> x
}
`

function render(dot) {
  const result = dotRun(['-Tsvg'], { input: dot, encoding: 'utf8' })
  return { ok: result.status === 0, warnings: result.stderr.trim() }
}

test('the light export writes the house look and class colors into every view', () => {
  const out = exportDot(text, { theme: 'light' })
  assert.match(out, /digraph checkout \{\n  graph \[[^\]]*bgcolor="#ffffff"/)
  assert.match(out, /node \[shape=box, style="rounded,filled"[^\]]*fontname=Helvetica/)
  assert.match(out, /cart \[label=Cart, class=blue, fillcolor="#e9edfc", color="#5a6fd8"\]/)
  assert.match(out, /more \[label=More, URL="#more", penwidth=2.6\]/)
  assert.match(out, /digraph more \{\n  graph \[/)
  assert.match(out, /done \[label="Order placed", class=ghost, URL="#checkout", style="rounded,filled,dashed"/)
  const drawn = render(out)
  assert.ok(drawn.ok && drawn.warnings === '', drawn.warnings)
})

test('the dark export swaps every known color for its dark twin', () => {
  const out = exportDot(text, { theme: 'dark' })
  for (const entry of DEFAULT_PALETTE) {
    assert.ok(!out.includes(entry.fill.light) && !out.includes(entry.line.light), `${entry.name} light color left in the dark export`)
  }
  assert.match(out, /bgcolor="#1a1e27"/)
  assert.match(out, /cart \[label=Cart, class=blue, fillcolor="#252c4b", color="#8c9cf0"\]/)
  assert.match(out, /done \[label="Order placed", fillcolor="#1d3325"/)
  const drawn = render(out)
  assert.ok(drawn.ok && drawn.warnings === '', drawn.warnings)
})
