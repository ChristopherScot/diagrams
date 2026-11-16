import { LINE_STYLES, lineStyleOf, restyle } from './dot-text.js'
import { themeCss } from './dot-theme.js'
import { DEFAULT_PALETTE, paletteClass } from './palette.js'

const STYLE_ID = 'dot-style-bar-style'
const STYLE = `
.dot-style-bar[hidden] { display: none; }
.dot-style-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 18px; font: 13px/1.3 system-ui, sans-serif; color: var(--ds-fg, #16181d); }
.dot-style-bar .ds-group { display: flex; align-items: center; gap: 6px; }
.dot-style-bar .ds-label { color: var(--ds-muted, #5d6470); font-size: 12px; }
.dot-style-bar .ds-segmented { display: inline-flex; border: 1px solid var(--ds-line, #dde1e7); border-radius: 6px; overflow: hidden; }
.dot-style-bar .ds-segmented button { display: grid; place-items: center; width: 32px; height: 26px; padding: 0; border: 0; border-left: 1px solid var(--ds-line, #dde1e7); background: var(--ds-bg, #fff); color: inherit; cursor: pointer; }
.dot-style-bar .ds-segmented button:first-child { border-left: 0; }
.dot-style-bar .ds-segmented button[aria-pressed="true"] { background: var(--ds-accent, #2563eb); color: #fff; }
.dot-style-bar .ds-segmented svg { width: 22px; height: 12px; stroke: currentColor; fill: none; }
.dot-style-bar .ds-swatches { display: flex; align-items: center; gap: 4px; }
.dot-style-bar .ds-swatch { width: 20px; height: 20px; padding: 0; border: 1px solid var(--ds-line, rgb(0 0 0 / 0.18)); border-radius: 50%; cursor: pointer; }
.dot-style-bar .ds-pair { border-width: 2px; }
.dot-style-bar .ds-swatch[aria-pressed="true"] { outline: 2px solid var(--ds-accent, #2563eb); outline-offset: 2px; }
.dot-style-bar .ds-none { background: linear-gradient(135deg, transparent 45%, #d92d20 45% 55%, transparent 55%), var(--ds-bg, #fff); }
.dot-style-bar button:focus-visible { outline: 2px solid var(--ds-accent, #2563eb); outline-offset: 2px; }
`

const SHAPES = [
  ['box', 'Rectangle', '<rect x="2" y="1" width="18" height="10" stroke-width="1.5"/>'],
  ['ellipse', 'Ellipse', '<ellipse cx="11" cy="6" rx="9" ry="5" stroke-width="1.5"/>'],
  ['circle', 'Circle', '<circle cx="11" cy="6" r="5" stroke-width="1.5"/>'],
  ['diamond', 'Diamond', '<path d="M11 0.5 L20 6 L11 11.5 L2 6 Z" stroke-width="1.5"/>'],
  ['hexagon', 'Hexagon', '<path d="M6 1 H16 L20 6 L16 11 H6 L2 6 Z" stroke-width="1.5"/>'],
  ['cylinder', 'Cylinder', '<path d="M4 3 V9 A7 2 0 0 0 18 9 V3 A7 2 0 0 0 4 3 A7 2 0 0 0 18 3" stroke-width="1.5"/>'],
  ['note', 'Note', '<path d="M3 1 H15 L19 5 V11 H3 Z M15 1 V5 H19" stroke-width="1.5"/>'],
  ['plaintext', 'Text only', '<text x="11" y="10" text-anchor="middle" font-size="10" font-family="system-ui, sans-serif" fill="currentColor" stroke="none">Aa</text>'],
]

const SHAPE_ALIASES = { rect: 'box', rectangle: 'box', oval: 'ellipse', plain: 'plaintext', none: 'plaintext' }

const LINE_ICONS = {
  solid: '<line x1="1" y1="6" x2="21" y2="6" stroke-width="2"/>',
  dashed: '<line x1="1" y1="6" x2="21" y2="6" stroke-width="2" stroke-dasharray="5 3"/>',
  dotted: '<line x1="1" y1="6" x2="21" y2="6" stroke-width="2" stroke-dasharray="1.5 3" stroke-linecap="round"/>',
  bold: '<line x1="1" y1="6" x2="21" y2="6" stroke-width="4"/>',
}

const DIRECTIONS = [
  ['forward', 'One way', '<line x1="1" y1="6" x2="17" y2="6" stroke-width="2"/><path d="M14 2 L21 6 L14 10" stroke-width="2"/>'],
  ['both', 'Both ways', '<line x1="5" y1="6" x2="17" y2="6" stroke-width="2"/><path d="M8 2 L1 6 L8 10 M14 2 L21 6 L14 10" stroke-width="2"/>'],
  ['none', 'No arrowhead', '<line x1="1" y1="6" x2="21" y2="6" stroke-width="2"/>'],
]

function injectStyle(document) {
  if (document.getElementById(STYLE_ID) != null) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = STYLE
  document.head.append(style)
}

function attrEdit(selection, key, value) {
  if (selection.kind === 'node') return { type: 'setNodeAttr', node: selection.id, key, value }
  if (selection.kind === 'cluster') return { type: 'setGraphAttr', subgraph: selection.id, key, value }
  return { type: 'setEdgeAttr', edge: { from: selection.from, to: selection.to, index: selection.index }, key, value }
}

function currentStyle(selection) {
  return selection.attrs.style ?? selection.defaults.style ?? ''
}

function styleEdit(selection, next) {
  const fallback = restyle(selection.defaults.style)
  if (next === fallback) return attrEdit(selection, 'style', null)
  return attrEdit(selection, 'style', next === '' ? 'solid' : next)
}

export function lineStyleEdit(selection, line) {
  return styleEdit(selection, restyle(currentStyle(selection), { line }))
}

function naturalShape(selection) {
  return selection.defaults.shape ?? 'ellipse'
}

export function shapeOf(selection) {
  const shape = selection.attrs.shape ?? naturalShape(selection)
  return SHAPE_ALIASES[shape] ?? shape
}

export function shapeEdit(selection, shape) {
  const natural = SHAPE_ALIASES[naturalShape(selection)] ?? naturalShape(selection)
  return attrEdit(selection, 'shape', shape === natural ? null : shape)
}

export function colorEdit(selection, entry) {
  const edits = [attrEdit(selection, 'class', entry?.class ?? null), attrEdit(selection, 'color', null)]
  if (selection.kind === 'cluster') edits.push(attrEdit(selection, 'bgcolor', null))
  if (selection.kind === 'node') {
    edits.push(attrEdit(selection, 'fillcolor', null))
    const style = currentStyle(selection)
    if (entry != null && restyle(style, { filled: true }) !== restyle(style)) edits.push(styleEdit(selection, restyle(style, { filled: true })))
  }
  return { type: 'batch', edits }
}

export function colorOf(selection, palette = DEFAULT_PALETTE) {
  return paletteClass(palette, selection.attrs.class)
}

export function directionEdit(selection, direction) {
  const natural = selection.graphKind === 'graph' ? 'none' : 'forward'
  return attrEdit(selection, 'dir', direction === natural ? null : direction)
}

export function createStyleBar(element, { onEdit, graph, palette = DEFAULT_PALETTE, classLabel = () => null }) {
  const document = element.ownerDocument
  injectStyle(document)
  element.classList.add('dot-style-bar')
  element.hidden = true

  function emit(edit) {
    if (graph == null) onEdit(edit)
    else if (edit.type === 'batch') onEdit({ ...edit, edits: edit.edits.map(inner => ({ ...inner, graph })) })
    else onEdit({ ...edit, graph })
  }

  function group(label, ...children) {
    const wrapper = document.createElement('div')
    wrapper.className = 'ds-group'
    const caption = document.createElement('span')
    caption.className = 'ds-label'
    caption.textContent = label
    wrapper.append(caption, ...children)
    return wrapper
  }

  function segmented(label, options, active, choose) {
    const box = document.createElement('div')
    box.className = 'ds-segmented'
    box.setAttribute('role', 'group')
    box.setAttribute('aria-label', label)
    for (const [value, name, icon] of options) {
      const button = document.createElement('button')
      button.type = 'button'
      button.title = name
      button.setAttribute('aria-label', name)
      button.setAttribute('aria-pressed', String(value === active))
      button.innerHTML = `<svg viewBox="0 0 22 12" aria-hidden="true">${icon}</svg>`
      button.addEventListener('click', () => choose(value))
      box.append(button)
    }
    return box
  }

  function colorSwatches(selection) {
    const box = document.createElement('div')
    box.className = 'ds-swatches'
    box.setAttribute('role', 'group')
    box.setAttribute('aria-label', 'Color')
    const active = colorOf(selection, palette)
    const reset = document.createElement('button')
    reset.type = 'button'
    reset.className = 'ds-swatch ds-none'
    reset.title = 'Default'
    reset.setAttribute('aria-label', 'Color: default')
    reset.setAttribute('aria-pressed', String(active == null))
    reset.addEventListener('click', () => emit(colorEdit(selection, null)))
    box.append(reset)
    for (const entry of palette) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'ds-swatch ds-pair'
      button.title = classLabel(entry.class) ? `${entry.name}: ${classLabel(entry.class)}` : entry.name
      button.style.background = themeCss(selection.kind === 'edge' ? entry.line.light : entry.fill.light, selection.kind === 'edge' ? 'ink' : 'surface', palette)
      button.style.borderColor = themeCss(entry.line.light, 'ink', palette)
      button.setAttribute('aria-label', `Color: ${entry.name}`)
      button.setAttribute('aria-pressed', String(active === entry))
      button.addEventListener('click', () => emit(colorEdit(selection, entry)))
      box.append(button)
    }
    return box
  }

  function show(selection) {
    element.replaceChildren()
    element.hidden = selection == null || selection.editable === false || selection.ghost === true
    if (element.hidden) return
    const value = key => selection.attrs[key] ?? selection.defaults[key]
    element.append(group('Color', colorSwatches(selection)))
    if (selection.kind === 'node') {
      element.append(group('Shape', segmented('Shape', SHAPES, shapeOf(selection), shape => emit(shapeEdit(selection, shape)))))
    }
    const lineOptions = LINE_STYLES.map(name => [name, name[0].toUpperCase() + name.slice(1), LINE_ICONS[name]])
    element.append(group('Line', segmented('Line style', lineOptions, lineStyleOf(currentStyle(selection)), line => emit(lineStyleEdit(selection, line)))))
    if (selection.kind === 'edge') {
      const natural = selection.graphKind === 'graph' ? 'none' : 'forward'
      element.append(group('Arrow', segmented('Arrow direction', DIRECTIONS, value('dir') ?? natural, direction => emit(directionEdit(selection, direction)))))
    }
  }

  return {
    show,
    destroy() {
      element.replaceChildren()
      element.classList.remove('dot-style-bar')
    },
  }
}
