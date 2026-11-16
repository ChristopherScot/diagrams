import { test } from 'node:test'
import assert from 'node:assert/strict'
import { diagramId, createBrowserLibrary, createAutosaver, createDbLibrary } from '../lib/library-store.js'

test('diagram ids are slugs of the name, numbered on a clash', () => {
  assert.equal(diagramId('Payments flow'), 'payments-flow')
  assert.equal(diagramId('Café crème!'), 'cafe-creme')
  assert.equal(diagramId(''), 'diagram')
  assert.equal(diagramId('Billing', ['billing', 'billing-2']), 'billing-3')
})

test('the browser library lists, saves, loads and removes diagrams', async () => {
  const library = createBrowserLibrary({ prefix: `t${Date.now()}` })
  await library.save('one', 'digraph one {}')
  await library.save('two', 'digraph two {}')
  assert.deepEqual((await library.list()).map(entry => entry.id).sort(), ['one', 'two'])
  assert.equal(await library.load('two'), 'digraph two {}')
  await library.remove('one')
  assert.deepEqual((await library.list()).map(entry => entry.id), ['two'])
  assert.equal(await library.load('one'), null)
  await assert.rejects(() => library.save('Not valid', ''), TypeError)
})

test('the db library keeps each viewer\'s diagrams under their private path', async () => {
  const store = new Map()
  const fakeDb = {
    doc(path) {
      return {
        collection(name) {
          const base = `${path}/${name}`
          return {
            async get() {
              return { docs: [...store].filter(([key]) => key.startsWith(`${base}/`)).map(([key, data]) => ({ id: key.slice(base.length + 1), exists: true, data: () => data })) }
            },
            doc(id) {
              const key = `${base}/${id}`
              return {
                async get() { return { exists: store.has(key), data: () => store.get(key) } },
                async set(data) { store.set(key, data) },
                async delete() { store.delete(key) },
              }
            },
          }
        },
      }
    },
  }
  const library = createDbLibrary(fakeDb, 'u1')
  await library.save('flow', 'digraph flow {}')
  assert.deepEqual([...store.keys()], ['data/users/u1/library/diagrams/flow'])
  assert.equal(await library.load('flow'), 'digraph flow {}')
  assert.deepEqual((await library.list()).map(entry => entry.id), ['flow'])
})

test('the autosaver writes only the latest text after a pause, in order', async () => {
  const writes = []
  const library = { save: async (id, text) => writes.push([id, text]) }
  const saver = createAutosaver(library, 'flow', { delay: 10 })
  saver.save('a')
  saver.save('b')
  await new Promise(resolve => setTimeout(resolve, 30))
  await saver.flush()
  assert.deepEqual(writes, [['flow', 'b']])
})
