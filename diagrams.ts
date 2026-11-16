import { createHash } from 'node:crypto'
import { instance } from '@viz-js/viz'
import type { Store, Stored } from './store.ts'
import { parse, applyEdit, describe } from './lib/dot-text.js'
import { views, viewRules, viewText, legend, repairGhosts, impliedEdit } from './lib/dot-views.js'
import { vizValidator } from './lib/dot-document.js'
import { exportDot } from './lib/dot-export.js'
import { newShortId, linkFor } from './lib/library-store.js'

export class DiagramError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export type Diagram = Stored & { version: string, title: string, link: string }

const viz = await instance()
const graphviz = vizValidator(viz)

export function versionOf(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16)
}

function titleOf(text: string): string {
  try {
    return views(text)[0]?.title ?? 'Untitled diagram'
  } catch {
    return 'Untitled diagram'
  }
}

function present(entry: Stored): Diagram {
  const title = titleOf(entry.text)
  return { ...entry, version: versionOf(entry.text), title, link: linkFor(entry.id, title) }
}

export function check(text: string): string {
  if (typeof text !== 'string' || text.trim() === '') throw new DiagramError('The diagram is empty', 422)
  try {
    parse(text)
    viewRules(text)
    graphviz(text)
  } catch (error) {
    throw new DiagramError((error as Error).message.split('\n')[0], 422)
  }
  const repair = repairGhosts(text)
  return repair == null ? text : applyEdit(text, repair)
}

export function outline(text: string) {
  const all = views(text)
  return {
    title: titleOf(text),
    views: all.map(view => {
      const model = describe(text, { graph: view.id })
      const nodes = [...model.nodes.values()].filter(node => !String(node.attrs.style ?? '').includes('invis'))
      return {
        id: view.id,
        title: view.title,
        parent: view.parent,
        caption: view.caption ?? null,
        opens: view.links.filter((link: { ghost: boolean }) => !link.ghost).map((link: { id: string, kind: string, view: string }) => ({ from: link.id, kind: link.kind, view: link.view })),
        ghosts: nodes
          .filter(node => String(node.attrs.class ?? '').split(/\s+/).includes('ghost'))
          .map(node => ({ node: node.id, label: node.attrs.label ?? node.id, livesIn: String(node.attrs.URL ?? '').replace(/^#/, '') })),
        nodes: nodes.length,
        boxes: [...model.subgraphs.values()].filter(subgraph => subgraph.isCluster).map(subgraph => ({ id: subgraph.id, label: subgraph.attrs.label ?? subgraph.id, parent: subgraph.parent ?? null })),
      }
    }),
    legend: [...legend(text).entries()].map(([name, entry]) => ({ class: name, label: entry.label, color: entry.color ?? null })),
  }
}

export function createDiagrams(store: Store) {
  async function get(id: string): Promise<Diagram> {
    const found = await store.read(id)
    if (found == null) throw new DiagramError(`There is no diagram "${id}"`, 404)
    return present(found)
  }

  return {
    store,
    async list(): Promise<Diagram[]> {
      return (await store.list()).map(present).sort((a, b) => b.updated - a.updated)
    },
    get,
    async create(text: string): Promise<Diagram> {
      const ready = check(text)
      const taken = (await store.list()).map(entry => entry.id)
      const id = newShortId(taken)
      await store.write(id, ready)
      return get(id)
    },
    async update(id: string, text: string, { ifVersion }: { ifVersion?: string } = {}): Promise<Diagram> {
      const ready = check(text)
      if (ifVersion != null) {
        const current = await get(id)
        if (current.version !== ifVersion) {
          throw new DiagramError(`"${current.title}" changed since version ${ifVersion} (now ${current.version}); read it again and redo the change`, 409)
        }
      }
      await store.write(id, ready)
      return get(id)
    },
    async edit(id: string, edits: Array<{ type: string }>, { ifVersion }: { ifVersion?: string } = {}): Promise<Diagram> {
      const current = await get(id)
      if (ifVersion != null && current.version !== ifVersion) {
        throw new DiagramError(`"${current.title}" changed since version ${ifVersion} (now ${current.version}); read it again and redo the change`, 409)
      }
      let next = current.text
      for (const [index, edit] of edits.entries()) {
        try {
          next = applyEdit(next, impliedEdit(next, edit))
        } catch (error) {
          throw new DiagramError(`Edit ${index + 1} (${edit.type}): ${(error as Error).message.split('\n')[0]}`, 422)
        }
      }
      const ready = check(next)
      await store.write(id, ready)
      return get(id)
    },
    async remove(id: string): Promise<void> {
      await get(id)
      await store.remove(id)
    },
    async svg(id: string, { theme = 'light', view }: { theme?: string, view?: string | null } = {}): Promise<string> {
      const { text } = await get(id)
      const all = views(text)
      const chosen = all.find(candidate => candidate.id === view) ?? all[0]
      const source = viewText(exportDot(text, { theme: theme === 'dark' ? 'dark' : 'light' }), chosen.id)
      return viz.renderString(source, { format: 'svg' })
    },
  }
}

export type Diagrams = ReturnType<typeof createDiagrams>
