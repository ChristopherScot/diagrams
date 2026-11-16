import { describe, newClusterId, newNodeId } from './dot-text.js'

const STYLE_ID = 'dot-canvas-style'
const STYLE = `
.dot-canvas { position: relative; overflow: auto; outline: none; touch-action: pinch-zoom; -webkit-tap-highlight-color: transparent; -webkit-user-select: none; user-select: none; }
.dot-canvas svg { display: block; overflow: visible; touch-action: none; -webkit-touch-callout: none; }
.dot-canvas .dc-ghost, .dot-canvas .dc-ghost * { opacity: 0.55; pointer-events: none !important; }
.dot-canvas .dc-ghost * { opacity: 1; }
.dot-canvas .dc-overlay { position: absolute; left: 0; top: 0; z-index: 1; overflow: visible; pointer-events: none; }
.dot-canvas.dc-tool-box, .dot-canvas.dc-tool-box * { cursor: crosshair !important; }
.dot-canvas .dc-row-bar { stroke: var(--dc-accent, #2563eb); stroke-width: 4px; stroke-linecap: round; pointer-events: none; }
.dot-canvas .dc-handle { fill: var(--dc-accent, #2563eb); stroke: var(--dc-editor-bg, #fff); stroke-width: 2px; pointer-events: none; }
.dot-canvas .dc-handle-hit { fill: transparent; cursor: crosshair; pointer-events: all; }
.dot-canvas .dc-handle-hit[data-action="move"] { cursor: move; }
.dot-canvas .dc-grip { fill: var(--dc-editor-bg, #fff); stroke: var(--dc-accent, #2563eb); stroke-width: 1.5px; pointer-events: none; }
.dot-canvas .dc-grip-arrows { fill: none; stroke: var(--dc-accent, #2563eb); stroke-width: 1.5px; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
.dot-canvas .dc-target { cursor: pointer; }
.dot-canvas g.cluster.dc-target > :is(polygon, path):not(.dc-link-hit),
.dot-canvas g.node.dc-target > :is(polygon, ellipse, path, polyline):not(.dc-link-hit) { pointer-events: visible; }
.dot-canvas g.dc-linked > :is(path, polygon, ellipse):not(.dc-hit):not(.dc-link-hit) { stroke-width: 2.6px; }
.dot-canvas .dc-link-hit { fill: none; stroke: transparent; stroke-width: 16px; stroke-dasharray: none; vector-effect: non-scaling-stroke; pointer-events: stroke; cursor: pointer; }
.dot-canvas .dc-link-hit:hover { stroke: color-mix(in srgb, var(--dc-accent, #2563eb) 28%, transparent); }
.dot-canvas .dc-link-badge { cursor: pointer; }
.dot-canvas .dc-link-badge circle { stroke-width: 1.8px; }
.dot-canvas .dc-link-badge path { stroke-width: 1.8px; stroke-linecap: round; stroke-linejoin: round; }
.dot-canvas .dc-link-badge:hover circle { stroke-width: 2.6px; }
.dot-canvas .dc-hit { stroke: transparent; stroke-width: 14px; fill: none; pointer-events: stroke; }
.dot-canvas .dc-selected > :is(path, polygon, ellipse, polyline):not(.dc-hit):not(.dc-link-hit),
.dot-canvas .dc-drop > :is(path, polygon, ellipse, polyline):not(.dc-hit):not(.dc-link-hit) { stroke: var(--dc-accent, #2563eb); stroke-width: 2.5px; }
.dot-canvas .dc-drop > :is(path, polygon, ellipse):not(.dc-link-hit) { stroke-dasharray: 5 3; }
.dot-canvas .dc-marquee { fill: color-mix(in srgb, var(--dc-accent, #2563eb) 10%, transparent); stroke: var(--dc-accent, #2563eb); stroke-width: 1.5px; stroke-dasharray: 6 4; pointer-events: none; }
.dot-canvas .dc-wire { stroke: var(--dc-accent, #2563eb); stroke-width: 2px; stroke-dasharray: 6 4; fill: none; pointer-events: none; }
.dot-canvas .dc-editor {
  position: absolute; z-index: 2; box-sizing: border-box; min-width: 120px; padding: 4px 8px;
  font: 14px/1.35 system-ui, sans-serif; text-align: center; resize: none; overflow: hidden;
  color: var(--dc-editor-fg, #111); background: var(--dc-editor-bg, #fff);
  border: 2px solid var(--dc-accent, #2563eb); border-radius: 6px; box-shadow: 0 6px 16px rgb(0 0 0 / 0.18); outline: none;
}
`

const DRAG_THRESHOLD = 5
const TOUCH_DRAG_THRESHOLD = 10
const HANDLE_RADIUS = 6
const HANDLE_HIT_RADIUS = 16
const HANDLE_GAP = 18
const GRIP_RADIUS = 9
const INHERITED_LOOK = ['class', 'shape', 'style', 'color', 'fillcolor', 'fontcolor']

function injectStyle(document) {
  if (document.getElementById(STYLE_ID) != null) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = STYLE
  document.head.append(style)
}

function keyOf(target) {
  if (target.kind === 'edge') return `edge\u0000${target.from}\u0000${target.to}\u0000${target.index}`
  return `${target.kind}\u0000${target.id}`
}

function decodeLabel(value) {
  return value.replace(/\\[nlr]/g, '\n')
}

function encodeLabel(text) {
  return text.replace(/\r?\n/g, '\\n')
}

export function createDotCanvas(container, { render, onEdit, onSelect = () => {}, onToolChange = () => {}, onOpen = () => {}, onContextMenu = null, graph, defaults = {}, newNodeLabel = 'New node', newClusterLabel = 'New box' }) {
  const document = container.ownerDocument
  injectStyle(document)
  container.classList.add('dot-canvas')
  if (!container.hasAttribute('tabindex')) container.tabIndex = 0

  let source = ''
  let model = null
  let svg = null
  let targets = new Map()
  let elements = new Map()
  let selection = null
  let editor = null
  let pendingLabel = null
  let drag = null

  function emit(edit) {
    const scoped = edit.type === 'batch' ? { ...edit, edits: edit.edits.map(inner => ({ ...inner, graph })) } : { ...edit, graph }
    onEdit(graph == null ? edit : scoped)
  }

  function toSvgElement(output) {
    if (typeof output !== 'string') return output
    const parsed = new DOMParser().parseFromString(output, 'image/svg+xml').documentElement
    return document.importNode(parsed, true)
  }

  function resolveNode(name) {
    let candidate = name
    while (!model.nodes.has(candidate)) {
      const colon = candidate.lastIndexOf(':')
      if (colon < 0) return null
      candidate = candidate.slice(0, colon)
    }
    return candidate
  }

  function splitEdgeTitle(title) {
    const op = model.kind === 'digraph' ? '->' : '--'
    for (let at = title.indexOf(op); at >= 0; at = title.indexOf(op, at + 1)) {
      const from = resolveNode(title.slice(0, at))
      const to = resolveNode(title.slice(at + op.length))
      if (from != null && to != null) return { from, to }
    }
    return null
  }

  function addHitPath(group) {
    const path = group.querySelector(':scope > path')
    if (path == null) return
    const hit = path.cloneNode(false)
    hit.setAttribute('class', 'dc-hit')
    group.insertBefore(hit, group.firstChild)
  }

  function linkOf(target) {
    const url = target == null || target.kind === 'edge' ? null : attrsOf(target).URL
    return typeof url === 'string' && url.startsWith('#') ? url.slice(1) : null
  }

  function unwrapLinks() {
    for (const link of [...svg.querySelectorAll('a')]) {
      const wrapper = link.parentNode?.matches?.('g[id^="a_"]') ? link.parentNode : link
      wrapper.replaceWith(...link.childNodes)
    }
  }

  function addLinkRing(group, view, target) {
    const shape = group.querySelector(':scope > path:not(.dc-hit), :scope > polygon, :scope > ellipse')
    if (shape == null) return
    const svgNs = 'http://www.w3.org/2000/svg'
    const tip = () => {
      const title = document.createElementNS(svgNs, 'title')
      title.textContent = `Open ${view}`
      return title
    }
    const ring = shape.cloneNode(false)
    ring.setAttribute('class', 'dc-link-hit')
    ring.append(tip())
    group.append(ring)
    const ghost = target.kind === 'node' && String(attrsOf(target).class ?? '').split(/\s+/).includes('ghost')
    if (ghost) return
    group.classList.add('dc-linked')
    const box = target.kind === 'cluster' ? shape.getBBox() : group.getBBox()
    const classes = String(shape.getAttribute('class') ?? '').split(/\s+/)
    const strokeClasses = classes.filter(name => name.startsWith('dt-s')).join(' ')
    const fillClasses = classes.filter(name => name.startsWith('dt-f')).join(' ')
    const badge = document.createElementNS(svgNs, 'g')
    badge.setAttribute('class', 'dc-link-badge')
    badge.setAttribute('transform', `translate(${box.x + box.width} ${box.y})`)
    const circle = document.createElementNS(svgNs, 'circle')
    circle.setAttribute('r', '9')
    circle.setAttribute('fill', shape.getAttribute('fill') === 'none' ? 'white' : shape.getAttribute('fill') ?? 'white')
    circle.setAttribute('stroke', shape.getAttribute('stroke') ?? 'black')
    circle.setAttribute('class', `${fillClasses} ${strokeClasses}`.trim())
    const arrow = document.createElementNS(svgNs, 'path')
    arrow.setAttribute('d', 'M-3.5 -3.5 L3.5 3.5 M3.5 -1 V3.5 H-1')
    arrow.setAttribute('fill', 'none')
    arrow.setAttribute('stroke', shape.getAttribute('stroke') ?? 'black')
    arrow.setAttribute('class', strokeClasses)
    badge.append(tip(), circle, arrow)
    group.append(badge)
  }

  function indexSvg() {
    unwrapLinks()
    targets = new Map()
    elements = new Map()
    const counts = new Map()
    for (const group of svg.querySelectorAll('g.node, g.edge, g.cluster')) {
      const title = group.querySelector(':scope > title')?.textContent ?? ''
      let target = null
      if (group.classList.contains('node') && model.nodes.has(title) && !isHidden(title)) target = { kind: 'node', id: title }
      if (group.classList.contains('cluster') && model.subgraphs.has(title)) target = { kind: 'cluster', id: title }
      if (group.classList.contains('edge')) {
        const ends = splitEdgeTitle(title)
        if (ends != null) {
          const pair = `${ends.from}\u0000${ends.to}`
          const seen = counts.get(pair) ?? 0
          counts.set(pair, seen + 1)
          const edge = model.edges.filter(candidate => candidate.from === ends.from && candidate.to === ends.to && !isInvisible(candidate.attrs.style ?? model.defaults.edge.style))[seen]
          if (edge != null) {
            target = { kind: 'edge', from: ends.from, to: ends.to, index: edge.index, editable: edge.editable }
            addHitPath(group)
          }
        }
      }
      if (target == null) continue
      targets.set(group, target)
      elements.set(keyOf(target), group)
      group.classList.add('dc-target')
      const view = linkOf(target)
      if (view != null) addLinkRing(group, view, target)
    }
  }

  function isInvisible(style) {
    return /(^|,)\s*invis\s*(,|$)/.test(style ?? '')
  }

  function isHidden(node) {
    return isInvisible(model.nodes.get(node).attrs.style ?? model.defaults.node.style ?? defaults.node?.style)
  }

  function targetAt(element) {
    for (let current = element; current != null && current !== container; current = current.parentNode) {
      if (targets.has(current)) return targets.get(current)
    }
    return null
  }

  function attrsOf(target) {
    if (target.kind === 'node') return model.nodes.get(target.id)?.attrs ?? {}
    if (target.kind === 'cluster') return model.subgraphs.get(target.id)?.attrs ?? {}
    return model.edges.find(edge => edge.from === target.from && edge.to === target.to && edge.index === target.index)?.attrs ?? {}
  }

  function paintSelection() {
    for (const element of svg?.querySelectorAll('.dc-selected') ?? []) element.classList.remove('dc-selected')
    if (selection != null) elements.get(keyOf(selection))?.classList.add('dc-selected')
    drawHandles()
  }

  function defaultsOf(target) {
    if (target.kind === 'node') return { ...defaults.node, ...model.defaults.node }
    if (target.kind === 'edge') return { ...defaults.edge, ...model.defaults.edge }
    return { ...defaults.cluster }
  }

  function select(target) {
    selection = target
    paintSelection()
    onSelect(target == null ? null : { ...target, attrs: attrsOf(target), defaults: defaultsOf(target), graphKind: model.kind, cluster: parentOf(target), link: linkOf(target), ghost: target.kind === 'node' && String(attrsOf(target).class ?? '').split(/\s+/).includes('ghost'), row: target.kind === 'node' ? model.nodes.get(target.id)?.row ?? null : undefined })
  }

  function setSource(text) {
    const nextModel = describe(text, { graph })
    const previousModel = model
    model = nextModel
    let next
    try {
      next = toSvgElement(render(text))
    } catch (error) {
      model = previousModel
      throw error
    }
    closeEditor(false)
    source = text
    if (svg == null) container.append(next)
    else svg.replaceWith(next)
    svg = next
    indexSvg()
    hovered = null
    if (selection != null && !elements.has(keyOf(selection))) select(null)
    else if (selection != null) select(selection)
    drawHandles()
    const waiting = pendingLabel
    pendingLabel = null
    if (waiting != null && elements.has(keyOf(waiting))) {
      select(waiting)
      openEditor(waiting)
    }
  }

  function currentLabel(target) {
    const label = attrsOf(target).label
    if (label != null && typeof label === 'object') return { text: label.html, html: true }
    if (label != null) return { text: decodeLabel(label), html: false }
    return { text: target.kind === 'node' ? target.id : '', html: false }
  }

  function labelEdit(target, value) {
    if (target.kind === 'node') return { type: 'setNodeAttr', node: target.id, key: 'label', value }
    if (target.kind === 'cluster') return { type: 'setGraphAttr', subgraph: target.id, key: 'label', value }
    return { type: 'setEdgeAttr', edge: { from: target.from, to: target.to, index: target.index }, key: 'label', value }
  }

  function editorRect(target, group) {
    const text = group.querySelector('text')
    if (target.kind !== 'node' && text != null) return text.getBoundingClientRect()
    const box = group.getBoundingClientRect()
    if (target.kind === 'edge') return new DOMRect(box.x + box.width / 2 - 60, box.y + box.height / 2 - 14, 120, 28)
    return box
  }

  function sizeField(field) {
    field.rows = Math.max(1, field.value.split('\n').length)
  }

  function openEditor(target, replacement = null) {
    closeEditor(false)
    if (target == null || target.editable === false) return
    const group = elements.get(keyOf(target))
    if (group == null) return
    const original = currentLabel(target)
    const rect = editorRect(target, group)
    const host = container.getBoundingClientRect()
    const field = document.createElement('textarea')
    field.className = 'dc-editor'
    field.value = replacement ?? original.text
    field.spellcheck = false
    field.setAttribute('aria-label', 'Label')
    sizeField(field)
    const width = Math.max(rect.width + 16, 120)
    field.style.width = `${width}px`
    field.style.left = `${rect.left - host.left + container.scrollLeft + rect.width / 2 - width / 2}px`
    field.style.top = `${rect.top - host.top + container.scrollTop + rect.height / 2 - 18}px`
    container.append(field)
    editor = { field, target, original }
    field.addEventListener('input', () => sizeField(field))
    field.addEventListener('keydown', event => {
      event.stopPropagation()
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        closeEditor(true)
        container.focus({ preventScroll: true })
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        closeEditor(false)
        container.focus({ preventScroll: true })
      }
    })
    field.addEventListener('blur', () => closeEditor(true))
    field.focus({ preventScroll: true })
    if (replacement == null) field.select()
    else field.setSelectionRange(field.value.length, field.value.length)
  }

  function closeEditor(commit) {
    if (editor == null) return
    const { field, target, original } = editor
    editor = null
    field.remove()
    const text = field.value.replace(/\s+$/, '')
    if (!commit || text === original.text) return
    let value
    if (original.html) value = text === '' ? null : { html: text }
    else value = text === '' || (target.kind === 'node' && text === target.id) ? null : encodeLabel(text)
    emit(labelEdit(target, value))
  }

  const SVG_NS = 'http://www.w3.org/2000/svg'
  const overlay = document.createElementNS(SVG_NS, 'svg')
  overlay.setAttribute('class', 'dc-overlay')
  container.append(overlay)

  function sizeOverlay() {
    overlay.setAttribute('width', 0)
    overlay.setAttribute('height', 0)
    overlay.setAttribute('width', container.scrollWidth)
    overlay.setAttribute('height', container.scrollHeight)
  }

  function toOverlay(clientX, clientY) {
    const box = container.getBoundingClientRect()
    return {
      x: clientX - box.left - container.clientLeft + container.scrollLeft,
      y: clientY - box.top - container.clientTop + container.scrollTop,
    }
  }

  function centerOf(element) {
    const box = element.getBoundingClientRect()
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
  }

  function overlayShape(name, className) {
    const shape = document.createElementNS(SVG_NS, name)
    shape.setAttribute('class', className)
    overlay.append(shape)
    return shape
  }

  let hovered = null
  let handleOwners = new Map()

  function connectable(target) {
    return target != null && (target.kind === 'node' || target.kind === 'cluster') && elements.has(keyOf(target))
  }

  function handlePoints(target) {
    const box = elements.get(keyOf(target)).getBoundingClientRect()
    const host = container.getBoundingClientRect()
    const left = host.left + container.clientLeft + HANDLE_HIT_RADIUS
    const top = host.top + container.clientTop + HANDLE_HIT_RADIUS
    const right = host.left + container.clientLeft + container.clientWidth - HANDLE_HIT_RADIUS
    const bottom = host.top + container.clientTop + container.clientHeight - HANDLE_HIT_RADIUS
    const middle = { x: box.left + box.width / 2, y: box.top + box.height / 2 }
    const candidates = [
      { x: box.right + HANDLE_GAP, y: middle.y },
      { x: box.left - HANDLE_GAP, y: middle.y },
      { x: middle.x, y: box.bottom + HANDLE_GAP },
      { x: middle.x, y: box.top - HANDLE_GAP },
    ]
    const visible = candidates.filter(point => point.x >= left && point.x <= right && point.y >= top && point.y <= bottom)
    return [...visible, ...candidates.filter(point => !visible.includes(point))]
  }

  function drawHandles() {
    overlay.querySelector('.dc-handles')?.remove()
    handleOwners = new Map()
    if (svg == null || drag?.moved) return
    const owners = [selection, hovered].filter(connectable).filter((target, index, all) => all.findIndex(other => keyOf(other) === keyOf(target)) === index)
    if (owners.length === 0) return
    sizeOverlay()
    const layer = overlayShape('g', 'dc-handles')
    for (const owner of owners) {
      const points = handlePoints(owner)
      const actions = ['connect', 'connect-in', 'move']
      actions.forEach((action, index) => {
        const { x, y } = toOverlay(points[index].x, points[index].y)
        const circle = (className, radius) => {
          const shape = document.createElementNS(SVG_NS, 'circle')
          shape.setAttribute('class', className)
          shape.setAttribute('cx', x)
          shape.setAttribute('cy', y)
          shape.setAttribute('r', radius)
          layer.append(shape)
          return shape
        }
        const hit = circle('dc-handle-hit', HANDLE_HIT_RADIUS)
        hit.setAttribute('aria-label', `${action === 'move' ? 'Move' : action === 'connect-in' ? 'Draw a backward arrow from' : 'Connect from'} ${owner.id}`)
        hit.dataset.kind = owner.kind
        hit.dataset.id = owner.id
        hit.dataset.action = action
        handleOwners.set(hit, { owner, action })
        if (action === 'connect' || action === 'connect-in') {
          circle('dc-handle', HANDLE_RADIUS)
          return
        }
        circle('dc-grip', GRIP_RADIUS)
        const arrows = document.createElementNS(SVG_NS, 'path')
        arrows.setAttribute('class', 'dc-grip-arrows')
        const a = GRIP_RADIUS - 2.5
        arrows.setAttribute('d', `M${x - a} ${y}H${x + a}M${x} ${y - a}V${y + a}M${x - a + 2} ${y - 2}L${x - a} ${y}L${x - a + 2} ${y + 2}M${x + a - 2} ${y - 2}L${x + a} ${y}L${x + a - 2} ${y + 2}M${x - 2} ${y - a + 2}L${x} ${y - a}L${x + 2} ${y - a + 2}M${x - 2} ${y + a - 2}L${x} ${y + a}L${x + 2} ${y + a - 2}`)
        layer.append(arrows)
      })
    }
  }

  function setHovered(target) {
    const next = connectable(target) ? target : null
    if ((next == null && hovered == null) || (next != null && hovered != null && keyOf(next) === keyOf(hovered))) return
    hovered = next
    drawHandles()
  }

  function setDropTarget(element) {
    if (drag.drop === element) return
    drag.drop?.classList.remove('dc-drop')
    drag.drop = element
    element?.classList.add('dc-drop')
  }

  function startWire() {
    sizeOverlay()
    const start = centerOf(elements.get(keyOf(drag.target)))
    const { x, y } = toOverlay(start.x, start.y)
    drag.wire = overlayShape('line', 'dc-wire')
    drag.wire.setAttribute('x1', x)
    drag.wire.setAttribute('y1', y)
  }

  function updateWire(event) {
    const { x, y } = toOverlay(event.clientX, event.clientY)
    drag.wire.setAttribute('x2', x)
    drag.wire.setAttribute('y2', y)
  }

  function startMarquee() {
    sizeOverlay()
    drag.marquee = overlayShape('rect', 'dc-marquee')
    drag.inside = new Set()
  }

  function updateMarquee(event) {
    const left = Math.min(event.clientX, drag.x)
    const top = Math.min(event.clientY, drag.y)
    const right = Math.max(event.clientX, drag.x)
    const bottom = Math.max(event.clientY, drag.y)
    const corner = toOverlay(left, top)
    drag.marquee.setAttribute('x', corner.x)
    drag.marquee.setAttribute('y', corner.y)
    drag.marquee.setAttribute('width', right - left)
    drag.marquee.setAttribute('height', bottom - top)
    const enclosed = new Set()
    for (const [element, target] of targets) {
      if (target.kind !== 'cluster') continue
      const box = element.getBoundingClientRect()
      if (box.left >= left && box.right <= right && box.top >= top && box.bottom <= bottom) enclosed.add(target.id)
    }
    drag.clusters = new Set([...enclosed].filter(id => !ancestorsOf(id).some(ancestor => enclosed.has(ancestor))))
    drag.inside = new Set()
    for (const [element, target] of targets) {
      if (target.kind === 'cluster') {
        element.classList.toggle('dc-drop', drag.clusters.has(target.id))
        continue
      }
      if (target.kind !== 'node') continue
      const { x, y } = centerOf(element)
      const node = model.nodes.get(target.id)
      const carried = node.cluster != null && [node.cluster, ...ancestorsOf(node.cluster)].some(id => drag.clusters.has(id))
      const inside = x >= left && x <= right && y >= top && y <= bottom
      element.classList.toggle('dc-drop', inside)
      if (inside && !carried) drag.inside.add(target.id)
    }
  }

  let tool = 'select'

  function setTool(next) {
    if (next === tool) return
    tool = next
    container.classList.toggle('dc-tool-box', tool === 'box')
    onToolChange(tool)
  }

  function sharedClass(nodes, clusters) {
    const inSelected = node => {
      for (let box = node.cluster; box != null; box = model.subgraphs.get(box)?.parent) if (clusters.includes(box)) return true
      return false
    }
    const members = new Set([...nodes, ...[...model.nodes.values()].filter(node => !isInvisible(node.attrs.style) && inSelected(node)).map(node => node.id)])
    const looks = [...members].map(id => String(attrsOf({ kind: 'node', id }).class ?? '').split(/\s+/).filter(name => name !== '' && name !== 'ghost').join(' '))
    if (looks.length === 0) return null
    return looks[0] !== '' && looks.every(look => look === looks[0]) ? looks[0] : null
  }

  function finishBox(current, { nodes = [], clusters = [] } = {}) {
    setTool('select')
    const cluster = newClusterId(source, { graph })
    const box = { type: 'addCluster', cluster, attrs: { label: newClusterLabel } }
    pendingLabel = { kind: 'cluster', id: cluster }
    if (nodes.length > 0 || clusters.length > 0) {
      const shared = sharedClass(nodes, clusters)
      if (shared != null) box.attrs.class = shared
      emit({ ...box, nodes, clusters })
      return
    }
    const within = current.target == null ? undefined : current.target.kind === 'cluster' ? current.target.id : parentOf(current.target) ?? undefined
    emit({ ...box, subgraph: within })
  }

  function finishMarquee(current) {
    finishBox(current, { nodes: [...current.inside], clusters: [...current.clusters] })
  }

  function ancestorsOf(cluster) {
    const chain = []
    for (let current = model.subgraphs.get(cluster)?.parent; current != null; current = model.subgraphs.get(current)?.parent) chain.push(current)
    return chain
  }

  function parentOf(target) {
    if (target.kind === 'node') return model.nodes.get(target.id)?.cluster ?? null
    if (target.kind === 'cluster') return model.subgraphs.get(target.id)?.parent ?? null
    return undefined
  }

  function clusterAt(clientX, clientY, excluding = null) {
    let best = null
    for (const [element, target] of targets) {
      if (target.kind !== 'cluster') continue
      if (excluding != null && (target.id === excluding || ancestorsOf(target.id).includes(excluding))) continue
      const box = element.getBoundingClientRect()
      if (clientX < box.left || clientX > box.right || clientY < box.top || clientY > box.bottom) continue
      const area = box.width * box.height
      if (best == null || area < best.area) best = { element, target, area }
    }
    return best
  }

  function linkTargetAt(clientX, clientY) {
    const over = targetAt(document.elementFromPoint(clientX, clientY))
    if (over?.kind === 'node' || over?.kind === 'cluster') return over
    return clusterAt(clientX, clientY)?.target ?? null
  }

  function startGhost() {
    sizeOverlay()
    const host = container.getBoundingClientRect()
    const layer = svg.querySelector('g.graph') ?? svg
    const m = layer.getScreenCTM()
    const originX = host.left + container.clientLeft - container.scrollLeft
    const originY = host.top + container.clientTop - container.scrollTop
    const ghost = elements.get(keyOf(drag.target)).cloneNode(true)
    ghost.removeAttribute('id')
    ghost.removeAttribute('class')
    ghost.setAttribute('transform', `matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e - originX} ${m.f - originY})`)
    drag.ghost = overlayShape('g', 'dc-ghost')
    drag.ghost.append(ghost)
  }

  function rowSide(element, clientX, clientY) {
    const box = element.getBoundingClientRect()
    const across = ['LR', 'RL'].includes(String(model.attrs.rankdir ?? 'TB').toUpperCase())
    const before = across ? clientY < box.top + box.height / 2 : clientX < box.left + box.width / 2
    const a = across
      ? { x1: box.left, x2: box.right, y1: before ? box.top - 5 : box.bottom + 5, y2: before ? box.top - 5 : box.bottom + 5 }
      : { x1: before ? box.left - 5 : box.right + 5, x2: before ? box.left - 5 : box.right + 5, y1: box.top, y2: box.bottom }
    return { position: before ? 'before' : 'after', bar: a }
  }

  function showRowBar(bar) {
    drag.rowBar ??= overlayShape('line', 'dc-row-bar')
    const start = toOverlay(bar.x1, bar.y1)
    const end = toOverlay(bar.x2, bar.y2)
    drag.rowBar.setAttribute('x1', start.x)
    drag.rowBar.setAttribute('y1', start.y)
    drag.rowBar.setAttribute('x2', end.x)
    drag.rowBar.setAttribute('y2', end.y)
  }

  function updateGhost(event) {
    drag.ghost.setAttribute('transform', `translate(${event.clientX - drag.x} ${event.clientY - drag.y})`)
    if (drag.target.kind === 'node') {
      const over = targetAt(document.elementFromPoint(event.clientX, event.clientY))
      if (over?.kind === 'node' && over.id !== drag.target.id) {
        const element = elements.get(keyOf(over))
        const side = rowSide(element, event.clientX, event.clientY)
        drag.row = { target: over.id, position: side.position }
        setDropTarget(element)
        showRowBar(side.bar)
        return
      }
    }
    drag.row = null
    drag.rowBar?.remove()
    drag.rowBar = null
    const moving = drag.target.kind === 'cluster' ? drag.target.id : null
    const over = clusterAt(event.clientX, event.clientY, moving)
    setDropTarget(over?.element ?? null)
    drag.destination = over?.target.id ?? null
  }

  function finishGhost(current) {
    const id = current.target.id
    if (current.row != null) {
      emit({ type: 'placeInRow', node: id, target: current.row.target, position: current.row.position })
      return
    }
    const edits = []
    if (current.destination !== parentOf(current.target)) {
      edits.push(current.target.kind === 'cluster' ? { type: 'moveCluster', cluster: id, to: current.destination } : { type: 'moveNode', node: id, to: current.destination })
    }
    if (current.target.kind === 'node' && current.destination == null && model.nodes.get(id)?.row != null) edits.push({ type: 'leaveRow', node: id })
    if (edits.length === 1) emit(edits[0])
    if (edits.length > 1) emit({ type: 'batch', edits })
  }

  function endDrag(current) {
    current.wire?.remove()
    current.marquee?.remove()
    current.ghost?.remove()
    current.rowBar?.remove()
    current.drop?.classList.remove('dc-drop')
    for (const element of svg?.querySelectorAll('.dc-drop') ?? []) element.classList.remove('dc-drop')
  }

  function endpointOf(target) {
    return target.kind === 'cluster' ? { cluster: target.id } : target.id
  }

  function lookOf(target) {
    if (target?.kind !== 'node') return {}
    const attrs = attrsOf(target)
    const look = {}
    for (const key of INHERITED_LOOK) if (attrs[key] != null) look[key] = attrs[key]
    const classes = String(look.class ?? '').split(/\s+/).filter(name => name !== '' && name !== 'ghost')
    if (classes.length > 0) look.class = classes.join(' ')
    else delete look.class
    if (classes.length !== String(attrs.class ?? '').split(/\s+/).filter(Boolean).length) {
      for (const key of ['style', 'color', 'fillcolor', 'fontcolor']) delete look[key]
    }
    return look
  }

  function finishWire(current, event) {
    const hit = document.elementFromPoint(event.clientX, event.clientY)
    const over = linkTargetAt(event.clientX, event.clientY)
    if (over != null) {
      if (keyOf(over) === keyOf(current.target)) return
      if (current.backward) emit({ type: 'addEdge', from: endpointOf(over), to: endpointOf(current.target), attrs: { dir: 'back' } })
      else emit({ type: 'addEdge', from: endpointOf(current.target), to: endpointOf(over) })
      return
    }
    if (!container.contains(hit)) return
    addConnectedNode(current.target, { backward: current.backward })
  }

  function addConnectedNode(from, { backward = false } = {}) {
    const node = newNodeId(source, { label: newNodeLabel })
    pendingLabel = { kind: 'node', id: node }
    emit({
      type: 'batch',
      edits: [
        { type: 'addNode', node, attrs: { label: newNodeLabel, ...lookOf(from) } },
        backward ? { type: 'addEdge', from: node, to: endpointOf(from), attrs: { dir: 'back' } } : { type: 'addEdge', from: endpointOf(from), to: node },
      ],
    })
  }

  function onPointerDown(event) {
    if (event.button !== 0 || event.target === editor?.field) return
    container.focus({ preventScroll: true })
    const handle = handleOwners.get(event.target)
    const target = handle?.owner ?? targetAt(event.target)
    let mode = 'none'
    if (handle != null) mode = handle.action === 'connect-in' ? 'connect' : handle.action
    else if (tool === 'box') mode = 'box'
    else if (target?.kind === 'node') mode = 'connect'
    drag = {
      target,
      mode,
      backward: handle?.action === 'connect-in',
      onRing: event.target.classList?.contains('dc-link-hit') === true || event.target.closest?.('.dc-link-badge') != null,
      x: event.clientX,
      y: event.clientY,
      pointerId: event.pointerId,
      threshold: event.pointerType === 'touch' ? TOUCH_DRAG_THRESHOLD : DRAG_THRESHOLD,
      moved: false,
      wire: null,
      drop: null,
      marquee: null,
      clusters: new Set(),
      inside: new Set(),
      ghost: null,
      destination: null,
      row: null,
      rowBar: null,
    }
  }

  function onPointerMove(event) {
    if (drag == null) {
      if (event.pointerType === 'mouse') setHovered(handleOwners.get(event.target)?.owner ?? targetAt(event.target))
      return
    }
    if (!drag.moved) {
      if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < drag.threshold) return
      if (drag.mode === 'none') return
      drag.moved = true
      container.setPointerCapture(drag.pointerId)
      drawHandles()
      if (drag.mode === 'connect') startWire()
      if (drag.mode === 'move') startGhost()
      if (drag.mode === 'box') startMarquee()
    }
    if (drag.marquee != null) updateMarquee(event)
    if (drag.ghost != null) updateGhost(event)
    if (drag.wire == null) return
    updateWire(event)
    const over = linkTargetAt(event.clientX, event.clientY)
    setDropTarget(over != null && keyOf(over) !== keyOf(drag.target) ? elements.get(keyOf(over)) : null)
  }

  function onPointerUp(event) {
    if (drag == null) return
    const current = drag
    drag = null
    endDrag(current)
    if (!current.moved) {
      if (current.mode === 'box') finishBox(current)
      else if (current.onRing && linkOf(current.target) != null) onOpen(linkOf(current.target), current.target)
      else select(current.target)
      return
    }
    if (current.ghost != null) finishGhost(current)
    else if (current.marquee != null) finishMarquee(current)
    else if (current.wire != null) finishWire(current, event)
    drawHandles()
  }

  function onPointerCancel() {
    if (drag == null) return
    endDrag(drag)
    drag = null
    drawHandles()
  }

  function onMenu(event) {
    if (onContextMenu == null || event.target === editor?.field) return
    event.preventDefault()
    if (drag != null) {
      endDrag(drag)
      drag = null
    }
    const target = targetAt(event.target)
    if (target != null) select(target)
    onContextMenu({ clientX: event.clientX, clientY: event.clientY, target, link: linkOf(target) })
  }

  function onPointerLeave() {
    if (drag == null) setHovered(null)
  }

  function onDoubleClick(event) {
    if (event.target === editor?.field || handleOwners.has(event.target)) return
    const target = targetAt(event.target)
    if (target != null) {
      openEditor(target)
      return
    }
    if (svg == null) return
    const node = newNodeId(source, { label: newNodeLabel })
    pendingLabel = { kind: 'node', id: node }
    emit({ type: 'addNode', node, attrs: { label: newNodeLabel } })
  }

  function startsTyping(event) {
    return event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey && !event.isComposing
  }

  function onKeyDown(event) {
    if (event.target !== container) return
    if (event.key === 'Escape' && tool !== 'select') {
      setTool('select')
      return
    }
    if (selection == null) return
    if (event.key === 'Escape') {
      select(null)
      return
    }
    if (event.key === 'Enter' || event.key === 'F2') {
      event.preventDefault()
      openEditor(selection)
      return
    }
    if (event.key === 'Tab' && !event.metaKey && !event.ctrlKey && !event.altKey && (selection.kind === 'node' || selection.kind === 'cluster')) {
      event.preventDefault()
      addConnectedNode(selection, { backward: event.shiftKey })
      return
    }
    if (startsTyping(event)) {
      event.preventDefault()
      openEditor(selection, event.key)
      return
    }
    if (event.key !== 'Delete' && event.key !== 'Backspace') return
    event.preventDefault()
    const target = selection
    if (target.kind === 'node') emit({ type: 'removeNode', node: target.id })
    if (target.kind === 'edge' && target.editable !== false) {
      emit({ type: 'removeEdge', edge: { from: target.from, to: target.to, index: target.index } })
    }
  }

  container.addEventListener('pointerdown', onPointerDown)
  container.addEventListener('pointermove', onPointerMove)
  container.addEventListener('pointerup', onPointerUp)
  container.addEventListener('pointercancel', onPointerCancel)
  container.addEventListener('pointerleave', onPointerLeave)
  container.addEventListener('contextmenu', onMenu)
  container.addEventListener('scroll', drawHandles)
  document.defaultView?.addEventListener('resize', drawHandles)
  container.addEventListener('dblclick', onDoubleClick)
  container.addEventListener('keydown', onKeyDown)

  return {
    setSource,
    addConnected: addConnectedNode,
    setGraph(next) {
      closeEditor(false)
      graph = next
      hovered = null
      pendingLabel = null
      drag = null
      selection = null
      drawHandles()
      onSelect(null)
    },
    get graph() {
      return graph
    },
    setTool,
    get tool() {
      return tool
    },
    select,
    editLabel: openEditor,
    get selection() {
      return selection
    },
    destroy() {
      closeEditor(false)
      container.removeEventListener('pointerdown', onPointerDown)
      container.removeEventListener('pointermove', onPointerMove)
      container.removeEventListener('pointerup', onPointerUp)
      container.removeEventListener('pointercancel', onPointerCancel)
      container.removeEventListener('pointerleave', onPointerLeave)
      container.removeEventListener('contextmenu', onMenu)
      container.removeEventListener('scroll', drawHandles)
      document.defaultView?.removeEventListener('resize', drawHandles)
      overlay.remove()
      container.removeEventListener('dblclick', onDoubleClick)
      container.removeEventListener('keydown', onKeyDown)
      svg?.remove()
      container.classList.remove('dot-canvas')
    },
  }
}
