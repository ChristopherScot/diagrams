const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SHORT_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'
const SHORT = /^[abcdefghjkmnpqrstuvwxyz23456789]{4,12}$/

export function newShortId(taken = [], { random = Math.random, length = 4 } = {}) {
  const used = new Set(taken)
  for (let size = length; ; size += 1) {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      let id = ''
      for (let k = 0; k < size; k += 1) id += SHORT_ALPHABET[Math.floor(random() * SHORT_ALPHABET.length)]
      if (!used.has(id)) return id
    }
  }
}

export function isShortId(id) {
  return SHORT.test(String(id ?? ''))
}

export function idFromLink(link) {
  const id = String(link ?? '').split('-')[0]
  return isShortId(id) ? id : null
}

export function linkFor(id, title) {
  const slug = diagramId(title)
  return slug === 'diagram' ? id : `${id}-${slug}`
}

export function diagramId(title, taken = []) {
  const base = String(title ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'diagram'
  const used = new Set(taken)
  if (!used.has(base)) return base
  for (let k = 2; ; k += 1) if (!used.has(`${base}-${k}`)) return `${base}-${k}`
}

function checkId(id) {
  if (!ID.test(id)) throw new TypeError(`"${id}" can't be a diagram id`)
  return id
}

export function createServerLibrary({ base = '/api/diagrams' } = {}) {
  const url = id => `${base}/${encodeURIComponent(checkId(id))}`
  const ok = async response => {
    if (response.ok) return response
    let reason = `the server said ${response.status}`
    try {
      reason = (await response.json()).message ?? reason
    } catch {}
    throw new Error(reason)
  }
  return {
    kind: 'server',
    describe: () => 'the diagrams server',
    async list() {
      const response = await ok(await fetch(base, { cache: 'no-store' }))
      return (await response.json()).map(entry => ({ id: entry.id, text: entry.text, updated: entry.updated }))
    },
    async load(id) {
      const response = await fetch(url(id), { cache: 'no-store' })
      if (response.status === 404) return null
      return (await ok(response)).text()
    },
    async save(id, text) {
      await ok(await fetch(url(id), { method: 'PUT', body: text, headers: { 'content-type': 'text/vnd.graphviz' } }))
    },
    async create(text) {
      const response = await ok(await fetch(base, { method: 'POST', body: text, headers: { 'content-type': 'text/vnd.graphviz' } }))
      return (await response.json()).id
    },
    async remove(id) {
      await ok(await fetch(url(id), { method: 'DELETE' }))
    },
  }
}

export function createDbLibrary(db, userId) {
  const diagrams = db.doc(`data/users/${userId}/library`).collection('diagrams')
  return {
    kind: 'cloud',
    describe: () => 'your Claude account',
    async list() {
      const snapshot = await diagrams.get()
      return snapshot.docs.filter(doc => doc.exists).map(doc => ({ id: doc.id, text: doc.data().text, updated: doc.data().updated }))
    },
    async load(id) {
      const doc = await diagrams.doc(checkId(id)).get()
      return doc.exists ? doc.data().text : null
    },
    async save(id, text) {
      await diagrams.doc(checkId(id)).set({ text, updated: Date.now() })
    },
    async remove(id) {
      await diagrams.doc(checkId(id)).delete()
    },
    async create(text) {
      const snapshot = await diagrams.get()
      const id = newShortId(snapshot.docs.map(doc => doc.id))
      await diagrams.doc(id).set({ text, updated: Date.now() })
      return id
    },
  }
}

export function createBrowserLibrary({ prefix = 'dot-library' } = {}) {
  const memory = new Map()
  const read = key => {
    try {
      return localStorage.getItem(key)
    } catch {
      return memory.get(key) ?? null
    }
  }
  const write = (key, value) => {
    try {
      if (value == null) localStorage.removeItem(key)
      else localStorage.setItem(key, value)
    } catch {
      if (value == null) memory.delete(key)
      else memory.set(key, value)
    }
  }
  const index = () => {
    try {
      return JSON.parse(read(`${prefix}:index`) ?? '{}')
    } catch {
      return {}
    }
  }
  return {
    kind: 'browser',
    describe: () => 'this browser only',
    async list() {
      return Object.entries(index()).map(([id, updated]) => ({ id, updated, text: read(`${prefix}:${id}`) })).filter(entry => entry.text != null)
    },
    async load(id) {
      return read(`${prefix}:${checkId(id)}`)
    },
    async save(id, text) {
      write(`${prefix}:${checkId(id)}`, text)
      write(`${prefix}:index`, JSON.stringify({ ...index(), [id]: Date.now() }))
    },
    async remove(id) {
      const next = index()
      delete next[checkId(id)]
      write(`${prefix}:index`, JSON.stringify(next))
      write(`${prefix}:${id}`, null)
    },
    async create(text) {
      const id = newShortId(Object.keys(index()))
      await this.save(id, text)
      return id
    },
  }
}

export async function openLibrary({ claude = globalThis.claude, base = '/api/diagrams' } = {}) {
  try {
    const response = await fetch(base, { cache: 'no-store' })
    if (response.ok && (response.headers.get('content-type') ?? '').includes('json')) return createServerLibrary({ base })
  } catch {}
  if (claude?.use != null) {
    const [db, user] = await Promise.all([claude.use('db'), claude.use('user')])
    const id = await user?.id?.()
    if (db != null && id != null) return createDbLibrary(db, id)
  }
  return createBrowserLibrary()
}

export function createAutosaver(library, id, { delay = 400, onSaved = () => {} } = {}) {
  let timer = null
  let pending = null
  let writing = Promise.resolve()

  function flush() {
    clearTimeout(timer)
    timer = null
    if (pending == null) return writing
    const text = pending
    pending = null
    writing = writing
      .then(() => library.save(id, text))
      .then(() => onSaved({ ok: true }), error => onSaved({ ok: false, error }))
    return writing
  }

  return {
    id,
    save(text) {
      pending = text
      clearTimeout(timer)
      timer = setTimeout(flush, delay)
    },
    flush,
  }
}
