// TypeScript, run directly: Node strips types at load time, so there is
// no build step locally and the distroless image needs nothing extra.
// Stripping is not checking - `npm run typecheck` verifies these types
// and CI runs it before the tests.
//
// Few annotations, deliberately: Fastify infers request, reply and
// hook parameters from the route they attach to.
import Fastify, { LogController } from 'fastify'
import { collectDefaultMetrics, Counter, Histogram, register } from 'prom-client'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { storeFromEnv } from './store.ts'
import { createDiagrams, DiagramError, outline } from './diagrams.ts'
import { mountMcp } from './mcp.ts'
import { idFromLink } from './lib/library-store.js'

const port: number = Number(process.env.PORT || '3000')

// Matches what go-service's slog emits (ISO-8601 `time`, uppercase
// `level`, `msg`), so one Loki query works against either runtime.
// Bindings put service, team and version on every line for lines that
// leave Loki's label context.
const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
    base: {
      service: 'diagrams',
      team: 'me-myself-and-i',
      version: process.env.VERSION || 'dev',
    },
    timestamp: () => `,"time":"${new Date().toISOString()}"`,
    formatters: {
      level: (label: string) => ({ level: label.toUpperCase() }),
    },
    // Fastify's listening lines are silenced by returning an empty
    // message from listenTextResolver; drop those here so they do not
    // appear as blank entries.
    hooks: {
      logMethod(this: unknown, args: unknown[], method: (...a: unknown[]) => void) {
        if (args[0] === '') return
        return method.apply(this, args)
      },
    },
  },
  // Fastify's own per-request lines duplicate the onResponse hook below
  // and log the raw url. disableRequestLogging is deprecated in 5 and
  // goes away in 6, so route through LogController.
  logController: new LogController({ disableRequestLogging: true }),
})

collectDefaultMetrics()

const requests = new Counter({
  name: 'http_requests_total',
  help: 'Requests by route, method and status.',
  labelNames: ['route', 'method', 'status'],
})

const latency = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Request latency by route and method.',
  labelNames: ['route', 'method'],
})

// The oldest client this service answers, from MIN_VERSION. Empty means
// no floor. Read at startup rather than built in, so raising the floor
// is a config edit and a restart.
export const floor = { minVersion: process.env.MIN_VERSION ?? '' }

// Compare two versions as numbers, lowest part first. Clients send a
// bare semver (npm forbids the leading v); strip it from the floor too.
function below(got: string, floor: string): boolean {
  const parts = (v: string) => v.replace(/^v/, '').split('.').map(Number)
  const a = parts(got)
  const b = parts(floor)
  if (a.length !== 3 || b.length !== 3 || [...a, ...b].some(Number.isNaN)) {
    return false
  }
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i]
  }
  return false
}

// 410 Gone, not 429: generated clients retry 429 and 5xx and nothing
// else, so 410 stops them dead. FAILS OPEN on missing or unparseable
// versions - that is the kubelet, Alloy, curl and scripts. /metrics and
// /healthz are skipped outright: blocking a probe would turn a client
// problem into an outage.
app.addHook('onRequest', (request, reply, done) => {
  const route = request.routeOptions?.url ?? 'other'
  if (!floor.minVersion || route === '/metrics' || route === '/healthz') {
    return done()
  }
  const got = request.headers['client-version']
  if (typeof got !== 'string' || !got || !below(got, floor.minVersion)) {
    return done()
  }
  request.log.warn({
    route,
    client: request.headers['client-name'] ?? 'unknown',
    client_version: got,
    min_version: floor.minVersion,
  }, 'refusing a client below the floor')
  reply.code(410).send({ message: 'this client is too old; reload or upgrade' })
})

// The route label is the matched ROUTE PATTERN, never the raw url - a
// path can carry a token or an id and this reaches both the log
// aggregator and a metric label (unbounded cardinality in Prometheus).
app.addHook('onResponse', (request, reply, done) => {
  const route = request.routeOptions?.url ?? 'other'

  // Alloy scrapes /metrics every 15s and the kubelet probes /healthz
  // as often; logging those buries real traffic.
  if (route !== '/metrics' && route !== '/healthz') {
    const seconds = reply.elapsedTime / 1000
    requests.inc({ route, method: request.method, status: reply.statusCode })
    latency.observe({ route, method: request.method }, seconds)
    request.log.info({
      method: request.method,
      route,
      status: reply.statusCode,
      // Not rounded: Math.round on a sub-millisecond handler logs 0.
      duration_ms: reply.elapsedTime,
    }, 'request')
  }
  done()
})

app.get('/healthz', async (_request, reply) => reply.type('text/plain').send('ok\n'))

// The deployment annotates this pod for scraping here.
app.get('/metrics', async (_request, reply) =>
  reply.type(register.contentType).send(await register.metrics()))

const here = path.dirname(fileURLToPath(import.meta.url))
// The bundle (dist/server.js) ships next to dist/web/, built by
// scripts/build-web.mjs; from source the page loads lib/ as modules.
const bundled = import.meta.url.endsWith('.js')
const webFile = (name: string) => path.join(here, 'web', name)

export const diagrams = createDiagrams(storeFromEnv())

app.addContentTypeParser(['text/vnd.graphviz', 'text/plain'], { parseAs: 'string', bodyLimit: 2 * 1024 * 1024 }, (_request, body, done) => done(null, body))

app.setErrorHandler((error, request, reply) => {
  if (error instanceof DiagramError) return reply.code(error.status).send({ message: error.message })
  request.log.error({ err: error }, 'request failed')
  const status = (error as { statusCode?: number }).statusCode ?? 500
  return reply.code(status).send({ message: status === 500 ? 'Something went wrong on the server' : (error as Error).message })
})

async function sendPage(reply: { type: (t: string) => { send: (b: unknown) => unknown } }) {
  return reply.type('text/html; charset=utf-8').send(await readFile(webFile('index.html')))
}

app.get('/', async (_request, reply) => sendPage(reply))
app.get('/d/:link', async (request, reply) => {
  const { link } = request.params as { link: string }
  const match = /^(.+)\.(dot|svg)$/.exec(link)
  if (match == null) return sendPage(reply)
  const id = idFromLink(match[1])
  if (id == null) throw new DiagramError(`There is no diagram "${match[1]}"`, 404)
  if (match[2] === 'dot') {
    const diagram = await diagrams.get(id)
    return reply.type('text/vnd.graphviz; charset=utf-8').header('content-disposition', `inline; filename="${diagram.link}.dot"`).send(diagram.text)
  }
  const { theme, view } = request.query as { theme?: string, view?: string }
  return reply.type('image/svg+xml').send(await diagrams.svg(id, { theme, view }))
})

app.get('/viz.js', async (_request, reply) => {
  const file = bundled ? webFile('viz.js') : path.join(here, 'node_modules', '@viz-js', 'viz', 'dist', 'viz-global.js')
  return reply.type('text/javascript; charset=utf-8').header('cache-control', 'public, max-age=86400').send(await readFile(file))
})

if (!bundled) {
  app.get('/lib/:file', async (request, reply) => {
    const { file } = request.params as { file: string }
    if (!/^[a-z-]+\.js$/.test(file)) throw new DiagramError('Not found', 404)
    return reply.type('text/javascript; charset=utf-8').header('cache-control', 'no-store').send(await readFile(path.join(here, 'lib', file)))
  })
}

const idParam = (request: { params: unknown }) => {
  const id = idFromLink((request.params as { id: string }).id)
  if (id == null) throw new DiagramError('There is no such diagram', 404)
  return id
}
const ifMatch = (request: { headers: Record<string, unknown> }) => {
  const value = request.headers['if-match']
  return typeof value === 'string' ? value.replace(/^W\//, '').replace(/"/g, '') : undefined
}

app.get('/api/diagrams', async () => (await diagrams.list()).map(({ id, text, updated, version, title, link }) => ({ id, text, updated, version, title, link })))
app.post('/api/diagrams', async (request, reply) => {
  const diagram = await diagrams.create(String(request.body ?? ''))
  return reply.code(201).header('etag', `"${diagram.version}"`).send({ id: diagram.id, version: diagram.version, link: diagram.link })
})
app.get('/api/diagrams/:id', async (request, reply) => {
  const diagram = await diagrams.get(idParam(request))
  return reply.type('text/vnd.graphviz; charset=utf-8').header('etag', `"${diagram.version}"`).send(diagram.text)
})
app.get('/api/diagrams/:id/outline', async request => outline((await diagrams.get(idParam(request))).text))
app.put('/api/diagrams/:id', async (request, reply) => {
  const diagram = await diagrams.update(idParam(request), String(request.body ?? ''), { ifVersion: ifMatch(request) })
  return reply.code(200).header('etag', `"${diagram.version}"`).send({ id: diagram.id, version: diagram.version, link: diagram.link })
})
app.delete('/api/diagrams/:id', async (request, reply) => {
  await diagrams.remove(idParam(request))
  return reply.code(204).send()
})

mountMcp(app, diagrams)

// Draining inside terminationGracePeriodSeconds is what makes a rollout
// invisible to callers.
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, async () => {
    app.log.info('shutting down')
    await app.close()
    process.exit(0)
  })
}

// Exported so a test can use app.inject() against the real routes and
// hooks without binding a port.
export { app }

async function start(): Promise<void> {
  try {
    // Fastify logs a listening line itself, unconditionally and once
    // per bound address - `0.0.0.0` expands to every interface.
    // listenTextResolver returns '' and the logger drops empty
    // messages, leaving the one line below.
    await app.listen({ port, host: '0.0.0.0', listenTextResolver: () => '' })
    app.log.info({ addr: ':' + port }, 'started')
  } catch (err) {
    app.log.error({ err }, 'server stopped')
    process.exit(1)
  }
}

// Both extensions: locally `node server.ts`, in the image `node
// server.js` (Vite bundled). Checking only the source extension makes
// the bundle start nothing and exit 0 - a container that looks like it
// ran and stopped rather than a guard that did not match.
const entry = process.argv[1] ?? ''
if (entry.endsWith('server.ts') || entry.endsWith('server.js')) {
  await start()
}
