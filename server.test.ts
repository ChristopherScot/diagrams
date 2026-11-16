import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const dir = mkdtempSync(path.join(tmpdir(), 'diagrams-test-'))
process.env.STORAGE = 'folder'
process.env.DIAGRAMS_DIR = dir
const { app, floor } = await import('./server.ts')
after(() => rmSync(dir, { recursive: true, force: true }))

// app.inject() drives the real routes and hooks without binding a port.
after(() => app.close())

test('healthz reports ok', async () => {
  const res = await app.inject({ method: 'GET', url: '/healthz' })
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.trim(), 'ok')
})

test('root serves the editor page', async () => {
  const res = await app.inject({ method: 'GET', url: '/' })
  assert.equal(res.statusCode, 200)
  assert.match(String(res.headers['content-type']), /text\/html/)
  assert.match(res.body, /<title>/)
})

test('an unknown path is a 404', async () => {
  const res = await app.inject({ method: 'GET', url: '/nope' })
  assert.equal(res.statusCode, 404)
})

test('metrics are exposed in Prometheus format', async () => {
  await app.inject({ method: 'GET', url: '/' })
  const res = await app.inject({ method: 'GET', url: '/metrics' })

  assert.equal(res.statusCode, 200)
  // String() because a header can be absent; assert.match would throw
  // on undefined rather than fail readably.
  assert.match(String(res.headers['content-type']), /text\/plain/)
  assert.match(res.body, /http_requests_total\{[^}]*route="\/"/)
  assert.match(res.body, /nodejs_heap_size_total_bytes/)
})

// A raw URL as a label would write out caller-controlled path segments.
test('an unrouted path is never used as a label', async () => {
  await app.inject({ method: 'GET', url: '/secret-token-value/deadbeef' })
  const res = await app.inject({ method: 'GET', url: '/metrics' })

  assert.doesNotMatch(res.body, /deadbeef/)
  assert.match(res.body, /http_requests_total\{[^}]*route="other"/)
})

// The client floor, off unless MIN_VERSION is set. Every FAIL OPEN case
// matters more than the refusal.
test('the client floor refuses only what it should', async () => {
  const cases: Array<[string, string, string, number]> = [
    ['no floor set', '', '0.1.0', 200],
    ['above the floor', '0.3.0', '0.4.0', 200],
    ['exactly at the floor', '0.3.0', '0.3.0', 200],
    ['below the floor', '0.3.0', '0.2.9', 410],
    ['no version sent fails open', '0.3.0', '', 200],
    ['unparseable fails open', '0.3.0', 'banana', 200],
    ['a v-prefixed floor still compares', 'v0.3.0', '0.2.0', 410],
  ]
  const was = floor.minVersion
  try {
    for (const [name, min, sent, want] of cases) {
      floor.minVersion = min
      const res = await app.inject({
        method: 'GET',
        url: '/',
        headers: sent ? { 'client-version': sent } : {},
      })
      assert.equal(res.statusCode, want, name)
    }
  } finally {
    floor.minVersion = was
  }
})

// If a raised floor blocked /healthz the pod would fail probes and
// crashloop. Alloy is the same for /metrics.
test('probes and metrics survive an impossible floor', async () => {
  const was = floor.minVersion
  floor.minVersion = '99.99.99'
  try {
    for (const url of ['/healthz', '/metrics']) {
      const res = await app.inject({
        method: 'GET',
        url,
        // A version is sent on purpose: without one, fail-open would
        // pass whether or not these routes are excluded.
        headers: { 'client-version': '0.0.1' },
      })
      assert.notEqual(res.statusCode, 410, `${url} must never be refused`)
    }
  } finally {
    floor.minVersion = was
  }
})

const TWO_VIEWS = `digraph checkout {
  title="Checkout"
  store [label="Store", URL="#store", class=blue]
  done [label="Order placed"]
  store -> done
}

digraph store {
  title="Store"
  parent=checkout
  cart [label="Cart"]
}
`

async function create(text = TWO_VIEWS) {
  const res = await app.inject({ method: 'POST', url: '/api/diagrams', headers: { 'content-type': 'text/vnd.graphviz' }, payload: text })
  assert.equal(res.statusCode, 201, res.body)
  return res.json() as { id: string, version: string, link: string }
}

test('a new diagram gets a short id and a readable link from its title', async () => {
  const made = await create()
  assert.match(made.id, /^[a-z2-9]{4}$/)
  assert.equal(made.link, `${made.id}-checkout`)
  assert.ok(readdirSync(dir).includes(`${made.id}.dot`))
})

test('the link keeps working whatever the readable part says', async () => {
  const { id } = await create()
  for (const url of [`/d/${id}`, `/d/${id}-checkout`, `/d/${id}-an-old-name`]) {
    const res = await app.inject({ method: 'GET', url })
    assert.equal(res.statusCode, 200, url)
    assert.match(String(res.headers['content-type']), /text\/html/)
  }
  const raw = await app.inject({ method: 'GET', url: `/d/${id}.dot` })
  assert.equal(raw.body, TWO_VIEWS)
  const svg = await app.inject({ method: 'GET', url: `/d/${id}.svg?theme=dark&view=store` })
  assert.match(svg.body, /<svg[\s\S]*Cart/)
})

test('saves that break the format are refused with a reason', async () => {
  const { id } = await create()
  const res = await app.inject({ method: 'PUT', url: `/api/diagrams/${id}`, headers: { 'content-type': 'text/vnd.graphviz' }, payload: TWO_VIEWS.replace('parent=checkout', 'parent=nowhere') })
  assert.equal(res.statusCode, 422)
  assert.match(res.json().message, /doesn't exist \("nowhere"\)/)
  const unparseable = await app.inject({ method: 'PUT', url: `/api/diagrams/${id}`, headers: { 'content-type': 'text/vnd.graphviz' }, payload: 'digraph {' })
  assert.equal(unparseable.statusCode, 422)
})

test('a save based on an old version is refused', async () => {
  const { id, version } = await create()
  const first = await app.inject({ method: 'PUT', url: `/api/diagrams/${id}`, headers: { 'content-type': 'text/vnd.graphviz', 'if-match': `"${version}"` }, payload: TWO_VIEWS.replace('Order placed', 'Paid') })
  assert.equal(first.statusCode, 200, first.body)
  const stale = await app.inject({ method: 'PUT', url: `/api/diagrams/${id}`, headers: { 'content-type': 'text/vnd.graphviz', 'if-match': `"${version}"` }, payload: TWO_VIEWS })
  assert.equal(stale.statusCode, 409)
})

test('deleting moves the file to the trash', async () => {
  const { id } = await create()
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/diagrams/${id}` })).statusCode, 204)
  assert.equal((await app.inject({ method: 'GET', url: `/api/diagrams/${id}` })).statusCode, 404)
  assert.ok(readdirSync(path.join(dir, '.trash')).some(name => name.startsWith(id)))
})

async function mcp(method: string, params: unknown = {}) {
  const res = await app.inject({
    method: 'POST',
    url: '/mcp',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    payload: { jsonrpc: '2.0', id: 1, method, params },
  })
  assert.equal(res.statusCode, 200, res.body)
  const data = /^data: (.*)$/m.exec(res.body)
  return JSON.parse(data ? data[1] : res.body).result
}

async function tool(name: string, args: Record<string, unknown>) {
  const result = await mcp('tools/call', { name, arguments: args })
  return { error: result.isError === true, text: result.content[0].text as string, value: result.isError ? null : JSON.parse(result.content[0].text) }
}

test('MCP explains the format when a client connects', async () => {
  const init = await mcp('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } })
  assert.match(init.instructions, /Every `digraph` is a view/)
  const guide = await mcp('resources/read', { uri: 'diagrams://guide' })
  assert.match(guide.contents[0].text, /## Ghosts/)
  const tools = (await mcp('tools/list')).tools.map((entry: { name: string }) => entry.name).sort()
  assert.deepEqual(tools, ['create_diagram', 'delete_diagram', 'edit_diagram', 'link_for', 'list_diagrams', 'read_diagram', 'write_diagram'])
})

test('MCP reads a diagram as DOT plus its view tree', async () => {
  const { id } = await create()
  const read = await tool('read_diagram', { id })
  assert.equal(read.value.title, 'Checkout')
  assert.deepEqual(read.value.outline.views.map((view: { id: string, parent: string | null }) => [view.id, view.parent]), [['checkout', null], ['store', 'checkout']])
  assert.deepEqual(read.value.outline.views[0].opens, [{ from: 'store', kind: 'node', view: 'store' }])
  assert.match(read.value.links.editor, new RegExp(`/d/${id}-checkout$`))
  const one = await tool('read_diagram', { id, view: 'store' })
  assert.match(one.value.dot, /^digraph store/)
})

test('MCP edits behave like the editor: a rename follows into the linked view', async () => {
  const { id } = await create()
  const { version } = (await tool('read_diagram', { id })).value
  const edited = await tool('edit_diagram', { id, if_version: version, edits: [
    { type: 'setNodeAttr', graph: 'checkout', node: 'store', key: 'label', value: 'Shop' },
    { type: 'addNode', graph: 'store', node: 'refund', attrs: { label: 'Refund' } },
  ] })
  assert.equal(edited.error, false, edited.text)
  const after = (await tool('read_diagram', { id })).value
  assert.equal(after.outline.views[1].title, 'Shop')
  assert.match(after.dot, /refund \[label=Refund\]/)
  const stale = await tool('edit_diagram', { id, if_version: version, edits: [{ type: 'removeNode', graph: 'store', node: 'cart' }] })
  assert.equal(stale.error, true)
  assert.match(stale.text, /changed since version/)
})

test('MCP refuses a write that breaks a rule and says why', async () => {
  const made = await tool('create_diagram', { dot: TWO_VIEWS })
  const bad = await tool('write_diagram', { id: made.value.id, dot: TWO_VIEWS.replace('URL="#store"', 'URL="#nowhere"'), if_version: made.value.version })
  assert.equal(bad.error, true)
  assert.match(bad.text, /nowhere/)
})
