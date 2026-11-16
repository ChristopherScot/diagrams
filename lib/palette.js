import { NEUTRALS } from './house-style.js'
import { describe, parse, setNodeAttr, setEdgeAttr, setGraphAttr } from './dot-text.js'

export const DEFAULT_PALETTE = [
  { name: 'Blue', class: 'blue', fill: { light: '#e9edfc', dark: '#252c4b' }, line: { light: '#5a6fd8', dark: '#8c9cf0' } },
  { name: 'Green', class: 'green', fill: { light: '#e4f3e9', dark: '#1d3325' }, line: { light: '#3a9358', dark: '#6cc489' } },
  { name: 'Amber', class: 'amber', fill: { light: '#fbefdc', dark: '#382a18' }, line: { light: '#c4862a', dark: '#e0a85a' } },
  { name: 'Violet', class: 'violet', fill: { light: '#f0e9fb', dark: '#2c2340' }, line: { light: '#8761cf', dark: '#b394f0' } },
  { name: 'Rose', class: 'rose', fill: { light: '#fbe7ec', dark: '#3a1f28' }, line: { light: '#c94c6e', dark: '#ef8fa8' } },
  { name: 'Slate', class: 'slate', fill: { light: '#eceef3', dark: '#252931' }, line: { light: '#6d778a', dark: '#9aa3b5' } },
]

export function paletteDark(palette, light, role) {
  const key = role === 'surface' ? 'fill' : 'line'
  const match = palette.find(entry => entry[key].light.toLowerCase() === light.toLowerCase())?.[key].dark
  return match ?? NEUTRALS.find(neutral => neutral.role === role && neutral.light === light.toLowerCase())?.dark ?? null
}

export function paletteClass(palette, value) {
  const names = String(value ?? '').split(/\s+/)
  return palette.find(entry => names.includes(entry.class)) ?? null
}

function ghostHome(text, ghost) {
  const url = ghost.attrs.URL
  if (typeof url !== 'string' || !url.startsWith('#')) return null
  try {
    return describe(text, { graph: url.slice(1) }).nodes.get(ghost.id) ?? null
  } catch {
    return null
  }
}

export function resolveClasses(text, { palette = DEFAULT_PALETTE } = {}) {
  let result = text
  const fill = (current, attrs, key, value, write) => (attrs[key] == null ? write(current, key, value) : current)
  parse(text).graphs.forEach((_, graph) => {
    const model = describe(result, { graph })
    for (const node of model.nodes.values()) {
      if (String(node.attrs.class ?? '').split(/\s+/).includes('ghost')) {
        const write = (current, key, value) => setNodeAttr(current, { graph, node: node.id, key, value })
        const home = ghostHome(text, node)
        const style = String(node.attrs.style ?? home?.attrs.style ?? 'rounded,filled').split(',').map(part => part.trim()).filter(part => part !== '' && part !== 'dashed' && part !== 'dotted')
        result = fill(result, node.attrs, 'style', [...style, 'dashed'].join(','), write)
        const entry = paletteClass(palette, home?.attrs.class)
        for (const key of ['shape', 'fillcolor', 'color', 'fontcolor']) {
          const value = home?.attrs[key] ?? (key === 'fillcolor' ? entry?.fill.light : key === 'color' ? entry?.line.light : null)
          if (value != null) result = fill(result, node.attrs, key, value, write)
        }
        continue
      }
      const entry = paletteClass(palette, node.attrs.class)
      if (entry == null) continue
      const write = (current, key, value) => setNodeAttr(current, { graph, node: node.id, key, value })
      result = fill(result, node.attrs, 'fillcolor', entry.fill.light, write)
      result = fill(result, node.attrs, 'color', entry.line.light, write)
    }
    for (const edge of model.edges) {
      const entry = paletteClass(palette, edge.attrs.class)
      if (entry == null || !edge.editable) continue
      result = fill(result, edge.attrs, 'color', entry.line.light, (current, key, value) =>
        setEdgeAttr(current, { graph, edge: { from: edge.from, to: edge.to, index: edge.index }, key, value }))
    }
    for (const subgraph of model.subgraphs.values()) {
      const entry = paletteClass(palette, subgraph.attrs.class)
      if (entry == null || !subgraph.isCluster) continue
      const write = (current, key, value) => setGraphAttr(current, { graph, subgraph: subgraph.id, key, value })
      result = fill(result, subgraph.attrs, 'color', entry.line.light, write)
      result = fill(result, subgraph.attrs, 'bgcolor', entry.fill.light, write)
    }
  })
  return result
}
