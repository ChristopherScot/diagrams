import { parse, describe, setNodeAttr, setEdgeAttr, setGraphAttr, formatId, formatValue } from './dot-text.js'
import { DEFAULT_PALETTE, resolveClasses } from './palette.js'
import { HOUSE_LAYOUT, NEUTRALS } from './house-style.js'

const SURFACE_KEYS = new Set(['fillcolor', 'bgcolor'])
const COLOR_KEYS = ['color', 'fillcolor', 'fontcolor', 'bgcolor', 'pencolor']
const LINKED_PENWIDTH = '2.6'

function themed(palette, theme) {
  if (theme === 'light') return value => value
  return (value, key) => {
    if (typeof value !== 'string' || !value.startsWith('#')) return value
    const light = value.toLowerCase()
    const part = SURFACE_KEYS.has(key) ? 'fill' : 'line'
    const fromPalette = palette.find(entry => entry[part].light.toLowerCase() === light)?.[part].dark
    const anyPalette = palette.flatMap(entry => [entry.fill, entry.line]).find(pair => pair.light.toLowerCase() === light)?.dark
    const neutral = NEUTRALS.find(entry => entry.light === light)?.dark
    return fromPalette ?? neutral ?? anyPalette ?? value
  }
}

function attrLine(target, attrs) {
  const pairs = Object.entries(attrs).map(([key, value]) => `${formatId(key)}=${formatValue(value)}`)
  return `${target} [${pairs.join(', ')}]`
}

function houseDefaults(paint) {
  const recolor = attrs => Object.fromEntries(Object.entries(attrs).map(([key, value]) => [key, COLOR_KEYS.includes(key) ? paint(value, key) : value]))
  const panel = NEUTRALS.find(entry => entry.name === 'Panel').light
  return [
    attrLine('graph', recolor({ ...HOUSE_LAYOUT.graphAttributes, bgcolor: panel })),
    attrLine('node', recolor(HOUSE_LAYOUT.nodeAttributes)),
    attrLine('edge', recolor(HOUSE_LAYOUT.edgeAttributes)),
  ]
}

function withDefaults(text, lines) {
  const graphs = parse(text).graphs
  let result = text
  for (const graph of [...graphs].reverse()) {
    const insert = lines.map(line => `\n  ${line}`).join('')
    result = result.slice(0, graph.open + 1) + insert + result.slice(graph.open + 1)
  }
  return result
}

function isGhost(attrs) {
  return String(attrs.class ?? '').split(/\s+/).includes('ghost')
}

export function exportDot(text, { theme = 'light', palette = DEFAULT_PALETTE } = {}) {
  const paint = themed(palette, theme)
  let result = resolveClasses(text, { palette })
  parse(result).graphs.forEach((_, graph) => {
    const model = describe(result, { graph })
    for (const node of model.nodes.values()) {
      if (typeof node.attrs.URL === 'string' && node.attrs.URL.startsWith('#') && !isGhost(node.attrs) && node.attrs.penwidth == null) {
        result = setNodeAttr(result, { graph, node: node.id, key: 'penwidth', value: LINKED_PENWIDTH })
      }
      for (const key of COLOR_KEYS) {
        const value = node.attrs[key]
        if (value != null && paint(value, key) !== value) result = setNodeAttr(result, { graph, node: node.id, key, value: paint(value, key) })
      }
    }
    for (const edge of model.edges) {
      if (!edge.editable) continue
      for (const key of COLOR_KEYS) {
        const value = edge.attrs[key]
        if (value != null && paint(value, key) !== value) {
          result = setEdgeAttr(result, { graph, edge: { from: edge.from, to: edge.to, index: edge.index }, key, value: paint(value, key) })
        }
      }
    }
    for (const subgraph of model.subgraphs.values()) {
      if (!subgraph.isCluster) continue
      for (const key of COLOR_KEYS) {
        const value = subgraph.attrs[key]
        if (value != null && paint(value, key) !== value) result = setGraphAttr(result, { graph, subgraph: subgraph.id, key, value: paint(value, key) })
      }
    }
  })
  return withDefaults(result, houseDefaults(paint))
}
