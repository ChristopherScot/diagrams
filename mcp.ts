import type { FastifyInstance, FastifyRequest } from 'fastify'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import type { Diagrams } from './diagrams.ts'
import { DiagramError, outline } from './diagrams.ts'
import { viewText, views } from './lib/dot-views.js'
import { GUIDE, INSTRUCTIONS } from './format.ts'

type Links = (link: string, view?: string) => { editor: string, dot: string, svg: string }

function result(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] }
}

function refusal(error: unknown) {
  const message = error instanceof DiagramError ? error.message : `Something went wrong: ${(error as Error).message}`
  return { isError: true, content: [{ type: 'text' as const, text: message }] }
}

async function safely(run: () => Promise<unknown>) {
  try {
    return result(await run())
  } catch (error) {
    return refusal(error)
  }
}

export function buildMcp(diagrams: Diagrams, links: Links) {
  const server = new McpServer({ name: 'diagrams', version: process.env.VERSION ?? 'dev' }, { instructions: INSTRUCTIONS })

  server.registerResource('guide', 'diagrams://guide', { title: 'The drill-down diagram format', mimeType: 'text/markdown' }, async uri => ({
    contents: [{ uri: uri.href, mimeType: 'text/markdown', text: GUIDE }],
  }))

  const summary = (diagram: Awaited<ReturnType<Diagrams['get']>>) => ({
    id: diagram.id,
    title: diagram.title,
    version: diagram.version,
    updated: new Date(diagram.updated).toISOString(),
    links: links(diagram.link),
  })

  server.registerTool('list_diagrams', {
    title: 'List diagrams',
    description: 'Every saved diagram: id, title, version, last update and its links.',
    inputSchema: {},
  }, async () => safely(async () => (await diagrams.list()).map(diagram => ({ ...summary(diagram), views: views(diagram.text).length }))))

  server.registerTool('read_diagram', {
    title: 'Read a diagram',
    description: 'A diagram\'s DOT plus its outline: the view tree (id, title, parent, which nodes or boxes open which views), the ghosts in each view and where they live, its boxes, and the legend. Pass view to get only that view\'s digraph. Keep the returned version for if_version.',
    inputSchema: { id: z.string().describe('Diagram id (the short id, or the whole link slug)'), view: z.string().optional().describe('A view id to return only that digraph') },
  }, async ({ id, view }) => safely(async () => {
    const diagram = await diagrams.get(id.split('-')[0])
    return { ...summary(diagram), outline: outline(diagram.text), dot: view == null ? diagram.text : viewText(diagram.text, view) }
  }))

  server.registerTool('create_diagram', {
    title: 'Create a diagram',
    description: 'Save a new diagram from DOT. It must follow diagrams://guide; a refused save says what to fix. Returns its id, version and links.',
    inputSchema: { dot: z.string().describe('The whole DOT file: one digraph per view, the first being the top view') },
  }, async ({ dot }) => safely(async () => summary(await diagrams.create(dot))))

  server.registerTool('write_diagram', {
    title: 'Replace a diagram',
    description: 'Replace a diagram\'s whole DOT. Refused if it breaks a rule in diagrams://guide, or if if_version is not the current version (someone saved since you read it: read it again and redo the change).',
    inputSchema: {
      id: z.string(),
      dot: z.string().describe('The whole new DOT file'),
      if_version: z.string().describe('The version you last read'),
    },
  }, async ({ id, dot, if_version }) => safely(async () => summary(await diagrams.update(id.split('-')[0], dot, { ifVersion: if_version }))))

  server.registerTool('edit_diagram', {
    title: 'Edit a diagram',
    description: 'Apply edits, in order, the way the editor does: setting a node label renames every copy and keeps linked view titles in step; addEdge to { cluster } writes the box anchor; clusterToView turns a box into its own view. The edit types and fields are listed under "Edits" in diagrams://guide. All edits apply or none do.',
    inputSchema: {
      id: z.string(),
      if_version: z.string().describe('The version you last read'),
      edits: z.array(z.record(z.string(), z.unknown()).and(z.object({ type: z.string() }))).min(1).describe('Edit objects, e.g. { "type": "addNode", "graph": "store", "node": "refund", "attrs": { "label": "Refund" } }'),
    },
  }, async ({ id, if_version, edits }) => safely(async () => summary(await diagrams.edit(id.split('-')[0], edits, { ifVersion: if_version }))))

  server.registerTool('delete_diagram', {
    title: 'Delete a diagram',
    description: 'Delete a diagram. It is kept in the store\'s trash, not destroyed.',
    inputSchema: { id: z.string() },
    annotations: { destructiveHint: true },
  }, async ({ id }) => safely(async () => {
    await diagrams.remove(id.split('-')[0])
    return { deleted: id }
  }))

  server.registerTool('link_for', {
    title: 'Links to a diagram',
    description: 'The editor link, the raw .dot link and the drawing (.svg) link for a diagram, optionally opened at one view.',
    inputSchema: { id: z.string(), view: z.string().optional() },
  }, async ({ id, view }) => safely(async () => links((await diagrams.get(id.split('-')[0])).link, view)))

  return server
}

export function linksFor(request: FastifyRequest): Links {
  const base = (process.env.PUBLIC_URL ?? `${request.protocol}://${request.headers.host}`).replace(/\/$/, '')
  return (link, view) => ({
    editor: `${base}/d/${link}${view ? `#${view}` : ''}`,
    dot: `${base}/d/${link.split('-')[0]}.dot`,
    svg: `${base}/d/${link.split('-')[0]}.svg${view ? `?view=${encodeURIComponent(view)}` : ''}`,
  })
}

export function mountMcp(app: FastifyInstance, diagrams: Diagrams) {
  app.post('/mcp', async (request, reply) => {
    const server = buildMcp(diagrams, linksFor(request))
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    reply.hijack()
    reply.raw.on('close', () => {
      transport.close()
      server.close()
    })
    await server.connect(transport)
    await transport.handleRequest(request.raw, reply.raw, request.body)
  })
  const notAllowed = async (_request: FastifyRequest, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) =>
    reply.code(405).send({ message: 'This MCP server is stateless: POST JSON-RPC to /mcp' })
  app.get('/mcp', notAllowed)
  app.delete('/mcp', notAllowed)
  app.get('/format.md', async (_request, reply) => reply.type('text/markdown; charset=utf-8').send(GUIDE))
}
