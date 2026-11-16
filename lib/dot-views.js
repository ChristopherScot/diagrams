import { parse, describe, VIEW_ID, newNodeId, nodeSlug, isGeneratedId, DotEditError } from './dot-text.js'
import { DEFAULT_PALETTE } from './palette.js'

export class ViewRuleError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ViewRuleError'
  }
}

function linkTarget(value) {
  return typeof value === 'string' && value.startsWith('#') ? value.slice(1) : null
}

function firstLine(value) {
  return String(value ?? '').split('\\n')[0]
}

export function views(text) {
  return parse(text).graphs.map((graph, index) => {
    const model = describe(text, { graph: index })
    const id = graph.id?.value ?? null
    const links = []
    for (const node of model.nodes.values()) {
      const view = linkTarget(node.attrs.URL)
      if (view != null) links.push({ kind: 'node', id: node.id, view, ghost: String(node.attrs.class ?? '').split(/\s+/).includes('ghost') })
    }
    for (const subgraph of model.subgraphs.values()) {
      const view = linkTarget(subgraph.attrs.URL)
      if (view != null) links.push({ kind: 'cluster', id: subgraph.id, view, ghost: false })
    }
    return {
      id,
      index,
      title: typeof model.attrs.title === 'string' ? model.attrs.title : id,
      parent: model.attrs.parent ?? null,
      caption: model.attrs.caption ?? null,
      notes: model.attrs.notes ?? null,
      links,
    }
  })
}

export function ancestry(list, id) {
  const chain = []
  const seen = new Set()
  for (let view = list.find(candidate => candidate.id === id); view != null && !seen.has(view.id); view = list.find(candidate => candidate.id === view.parent)) {
    seen.add(view.id)
    chain.unshift(view)
  }
  return chain
}

export function viewText(text, id) {
  const graph = parse(text).graphs.find(candidate => candidate.id?.value === id)
  if (graph == null) throw new ViewRuleError(`There is no view "${id}"`)
  return text.slice(graph.start, graph.end)
}

export function viewRules(text) {
  const list = views(text)
  const ids = new Set()
  for (const view of list) {
    if (view.id == null) throw new ViewRuleError('Every graph needs a name to be a view')
    if (!VIEW_ID.test(view.id) || view.id === 'whole-map') throw new ViewRuleError(`"${view.id}" can't be a view id; use lowercase letters, digits and hyphens`)
    if (ids.has(view.id)) throw new ViewRuleError(`Two views are named "${view.id}"`)
    ids.add(view.id)
  }
  for (const view of list) {
    if (view.parent != null && !ids.has(view.parent)) throw new ViewRuleError(`"${view.title}" sits under a view that doesn't exist ("${view.parent}")`)
    if (view.parent === view.id) throw new ViewRuleError(`"${view.title}" can't sit under itself`)
    for (const link of view.links) {
      if (!ids.has(link.view)) throw new ViewRuleError(`"${link.id}" in "${view.title}" opens a view that doesn't exist ("${link.view}")`)
    }
  }
  for (const view of list) {
    const seen = new Set()
    for (let current = view; current?.parent != null; current = list.find(candidate => candidate.id === current.parent)) {
      if (seen.has(current.id)) throw new ViewRuleError(`"${view.title}" is inside its own chain of parents`)
      seen.add(current.id)
    }
  }
}

function replaceFirstLine(label, line) {
  const rest = String(label).split('\\n').slice(1)
  return [line, ...rest].join('\\n')
}

export function expandEdit(text, edit) {
  if (edit.type === 'batch') return { ...edit, edits: edit.edits.flatMap(inner => {
    const expanded = expandEdit(text, inner)
    return expanded.type === 'batch' ? expanded.edits : [expanded]
  }) }
  const list = views(text)
  if (edit.type === 'setNodeAttr' && edit.key === 'label') {
    const model = describe(text, { graph: edit.graph })
    const node = model.nodes.get(edit.node)
    const view = list.find(candidate => candidate.id === linkTarget(node?.attrs.URL))
    if (view == null || node.attrs.class?.split(/\s+/).includes('ghost')) return edit
    const before = firstLine(node.attrs.label ?? node.id)
    if (view.title !== before) return edit
    return { type: 'batch', edits: [edit, { type: 'setGraphAttr', graph: view.id, key: 'title', value: firstLine(edit.value ?? node.id) }] }
  }
  if (edit.type === 'setGraphAttr' && edit.key === 'title' && edit.subgraph == null) {
    const view = list.find(candidate => candidate.id === edit.graph || candidate.index === edit.graph)
    if (view == null) return edit
    const renames = []
    for (const other of list) {
      const model = describe(text, { graph: other.index })
      for (const link of other.links) {
        if (link.view !== view.id || link.kind !== 'node') continue
        const label = model.nodes.get(link.id).attrs.label ?? link.id
        if (firstLine(label) === view.title) renames.push({ type: 'setNodeAttr', graph: other.id, node: link.id, key: 'label', value: replaceFirstLine(label, edit.value) })
      }
    }
    return renames.length === 0 ? edit : { type: 'batch', edits: [edit, ...renames] }
  }
  return edit
}

export function copiesOf(text, view, node) {
  const list = views(text)
  const nodeIn = id => describe(text, { graph: id }).nodes.get(node)
  const here = nodeIn(view)
  if (here == null) return []
  const home = isGhost(here) ? linkTarget(here.attrs.URL) : view
  const copies = []
  for (const other of list) {
    if (other.id === view) continue
    const found = nodeIn(other.id)
    if (found == null) continue
    const isHome = other.id === home && !isGhost(found)
    const isGhostOfHome = isGhost(found) && linkTarget(found.attrs.URL) === home
    if (isHome || isGhostOfHome) copies.push({ view: other.id, title: other.title, node })
  }
  return copies
}

export function ghostCandidates(text, view) {
  const here = describe(text, { graph: view }).nodes
  const candidates = []
  for (const other of views(text)) {
    if (other.id === view) continue
    for (const node of describe(text, { graph: other.index }).nodes.values()) {
      const style = String(node.attrs.style ?? '')
      if (String(node.attrs.class ?? '').split(/\s+/).includes('ghost') || /(^|,)\s*invis/.test(style)) continue
      candidates.push({ view: other.id, viewTitle: other.title, node: node.id, label: String(node.attrs.label ?? node.id).replace(/\\n/g, ' '), here: here.has(node.id) })
    }
  }
  return candidates
}

export const MAP_ID = 'whole-map'

function isGhost(node) {
  return String(node?.attrs.class ?? '').split(/\s+/).includes('ghost')
}

function quote(value) {
  return `"${String(value).replace(/\\(?!n|l|r)/g, '\\\\').replace(/"/g, '\\"')}"`
}

const NODE_KEYS = ['label', 'class', 'shape', 'style', 'color', 'fillcolor', 'fontcolor', 'width', 'height', 'fixedsize', 'peripheries']
const EDGE_KEYS = ['label', 'class', 'style', 'color', 'fontcolor', 'dir', 'arrowhead', 'arrowtail']

function attrText(entries) {
  const parts = entries.filter(([, value]) => value != null && value !== '').map(([key, value]) => `${key}=${typeof value === 'object' && 'html' in value ? `<${value.html}>` : quote(value)}`)
  return parts.length === 0 ? '' : ` [${parts.join(' ')}]`
}

export function mapNodeId(view, node) {
  return `${view}::${node}`
}

export function wholeMap(text, { root, depth = Number.POSITIVE_INFINITY, overrides = new Map() } = {}) {
  const list = views(text)
  const models = new Map(list.map(view => [view.id, describe(text, { graph: view.index })]))
  const rootView = list.find(view => view.id === root) ?? list.find(view => view.parent == null) ?? list[0]
  const children = id => {
    const result = list.filter(view => view.parent === id && view.id !== id).map(view => view.id)
    const model = models.get(id)
    const linked = [...model.nodes.values()].filter(node => !isGhost(node)).map(node => linkTarget(node.attrs.URL))
    linked.push(...[...model.subgraphs.values()].map(subgraph => linkTarget(subgraph.attrs.URL)))
    for (const target of linked) if (target != null && target !== id && models.has(target) && !result.includes(target)) result.push(target)
    return result
  }
  const level = new Map([[rootView.id, 0]])
  const parentOf = new Map()
  const queue = [rootView.id]
  while (queue.length > 0) {
    const id = queue.shift()
    for (const child of children(id)) {
      if (level.has(child)) continue
      if (!(overrides.get(child) ?? level.get(id) < depth)) continue
      level.set(child, level.get(id) + 1)
      parentOf.set(child, id)
      queue.push(child)
    }
  }
  const realHome = name => [...models].find(([, model]) => model.nodes.has(name) && !isGhost(model.nodes.get(name)))?.[0] ?? null
  const resolve = (viewId, name, hops = 0) => {
    const node = models.get(viewId).nodes.get(name)
    const target = linkTarget(node?.attrs.URL)
    if (hops < 8 && target != null && target !== viewId && level.has(target)) {
      if (parentOf.get(target) === viewId && !isGhost(node)) return { group: target }
      const defined = models.get(target).nodes.get(name)
      if (defined != null && (!isGhost(defined) || linkTarget(defined.attrs.URL) !== viewId)) return resolve(target, name, hops + 1)
      if (defined == null && isGhost(node)) {
        const home = realHome(name)
        if (home == null) return { node: mapNodeId(viewId, name), view: viewId }
        if (level.has(home)) return resolve(home, name, hops + 1)
      }
      return { group: target }
    }
    return { node: mapNodeId(viewId, name), view: viewId }
  }
  const chainOf = id => {
    const chain = []
    for (let current = id; current != null && !chain.includes(current); current = parentOf.get(current)) chain.push(current)
    return chain
  }
  const within = (end, group) => chainOf(end.group ?? end.view).includes(group)
  const boxName = (view, cluster) => `cluster_v_${view}__${cluster}`
  const groupName = view => `cluster_v_${view}`
  const owners = { nodes: new Map(), boxes: new Map(), edges: [] }
  const anchors = new Set()
  const edgeLines = []
  const seen = new Set()
  const counts = new Map()
  const candidates = []
  for (const viewId of level.keys()) {
    const model = models.get(viewId)
    for (const edge of model.edges) {
      const tail = resolve(viewId, edge.from)
      const head = resolve(viewId, edge.to)
      const tailKey = tail.group != null ? `group:${tail.group}` : tail.node
      const headKey = head.group != null ? `group:${head.group}` : head.node
      const key = `${tailKey}|${headKey}|${JSON.stringify(edge.attrs.label ?? '')}`
      if (tailKey === headKey || seen.has(key)) continue
      seen.add(key)
      const entries = EDGE_KEYS.map(name => [name, edge.attrs[name]])
      let from = tail.node
      let to = head.node
      if (tail.group != null) {
        from = `anchor::${tail.group}`
        anchors.add(tail.group)
        if (!within(head, tail.group)) entries.push(['ltail', groupName(tail.group)])
      } else if (edge.attrs.ltail != null) entries.push(['ltail', boxName(viewId, edge.attrs.ltail)])
      if (head.group != null) {
        to = `anchor::${head.group}`
        anchors.add(head.group)
        if (!within(tail, head.group)) entries.push(['lhead', groupName(head.group)])
      } else if (edge.attrs.lhead != null) entries.push(['lhead', boxName(viewId, edge.attrs.lhead)])
      candidates.push({ tail, head, label: JSON.stringify(edge.attrs.label ?? ''), from, to, entries, source: { view: viewId, from: edge.from, to: edge.to, index: edge.index } })
    }
  }
  const detailed = (summary, side, other) => candidates.some(candidate =>
    candidate !== summary && candidate[side].group == null && candidate.label === summary.label &&
    within(candidate[side], summary[side].group) &&
    (candidate[other].node ?? `group:${candidate[other].group}`) === (summary[other].node ?? `group:${summary[other].group}`))
  for (const candidate of candidates) {
    if (candidate.tail.group != null && detailed(candidate, 'tail', 'head')) continue
    if (candidate.head.group != null && detailed(candidate, 'head', 'tail')) continue
    const pair = `${candidate.from}\u0000${candidate.to}`
    const index = counts.get(pair) ?? 0
    counts.set(pair, index + 1)
    owners.edges.push({ from: candidate.from, to: candidate.to, index, source: candidate.source })
    edgeLines.push(`  ${quote(candidate.from)} -> ${quote(candidate.to)}${attrText(candidate.entries)}`)
  }
  const lines = [`digraph ${quote(MAP_ID)} {`, '  compound=true']
  const rankdir = models.get(rootView.id).attrs.rankdir
  if (rankdir != null) lines.push(`  rankdir=${quote(rankdir)}`)
  const emitted = new Set()
  const emitNode = (viewId, node, indent) => {
    const resolved = resolve(viewId, node.id)
    if (resolved.node !== mapNodeId(viewId, node.id) || emitted.has(resolved.node)) return
    emitted.add(resolved.node)
    owners.nodes.set(resolved.node, { view: viewId, node: node.id })
    const entries = NODE_KEYS.map(name => [name, node.attrs[name]])
    if (node.attrs.label == null) entries[0] = ['label', node.id]
    const target = linkTarget(node.attrs.URL)
    if (target != null && models.has(target) && !level.has(target)) entries.push(['URL', `#${target}`])
    lines.push(`${indent}${quote(resolved.node)}${attrText(entries)}`)
  }
  const emitView = (viewId, indent) => {
    const model = models.get(viewId)
    const isRoot = viewId === rootView.id
    const inner = isRoot ? indent : `${indent}  `
    if (!isRoot) {
      const view = list.find(candidate => candidate.id === viewId)
      lines.push(`${indent}subgraph ${quote(groupName(viewId))} {`, `${inner}label=${quote(view.title)}`, `${inner}style="dashed,rounded"`, `${inner}URL=${quote(`#${viewId}`)}`)
      owners.boxes.set(groupName(viewId), { view: viewId, group: true })
      const parentModel = models.get(parentOf.get(viewId))
      const opener = parentModel == null ? null : [...parentModel.nodes.values()].find(node => !isGhost(node) && linkTarget(node.attrs.URL) === viewId) ?? [...parentModel.subgraphs.values()].find(box => box.isCluster && linkTarget(box.attrs.URL) === viewId)
      const look = String(opener?.attrs.class ?? '').split(/\s+/).filter(name => name !== '' && name !== 'ghost').join(' ')
      if (look !== '') lines.push(`${inner}class=${quote(look)}`)
    }
    if (anchors.has(viewId)) lines.push(`${inner}${quote(`anchor::${viewId}`)} [shape=point style=invis width=0.01 height=0.01 label=""]`)
    const boxes = [...model.subgraphs.values()].filter(subgraph => subgraph.isCluster)
    const opened = [...parentOf].filter(([, parent]) => parent === viewId).map(([child]) => child)
    const placeOf = child => {
      const opener = [...model.nodes.values()].find(node => !isGhost(node) && linkTarget(node.attrs.URL) === child)
      if (opener != null) return opener.cluster
      return boxes.find(box => linkTarget(box.attrs.URL) === child)?.id ?? null
    }
    const emitBox = (box, at) => {
      const name = boxName(viewId, box.id)
      owners.boxes.set(name, { view: viewId, cluster: box.id })
      const target = linkTarget(box.attrs.URL)
      lines.push(`${at}subgraph ${quote(name)} {`)
      for (const [key, value] of [['label', box.attrs.label], ['style', box.attrs.style ?? 'dashed'], ['class', box.attrs.class], ['color', box.attrs.color], ['bgcolor', box.attrs.bgcolor]]) {
        if (value != null) lines.push(`${at}  ${key}=${typeof value === 'object' ? `<${value.html}>` : quote(value)}`)
      }
      if (target != null && models.has(target) && !level.has(target)) lines.push(`${at}  URL=${quote(`#${target}`)}`)
      for (const node of model.nodes.values()) if (node.cluster === box.id) emitNode(viewId, node, `${at}  `)
      for (const child of boxes) if (child.parent === box.id) emitBox(child, `${at}  `)
      for (const child of opened) if (placeOf(child) === box.id) emitView(child, `${at}  `)
      lines.push(`${at}}`)
    }
    for (const box of boxes) if (box.parent == null) emitBox(box, inner)
    for (const node of model.nodes.values()) if (node.cluster == null) emitNode(viewId, node, inner)
    for (const child of opened) if (placeOf(child) == null) emitView(child, inner)
    if (!isRoot) lines.push(`${indent}}`)
  }
  emitView(rootView.id, '  ')
  lines.push(...edgeLines, '}')
  return { dot: `${lines.join('\n')}\n`, root: rootView.id, expanded: [...level.keys()], levels: Math.max(0, ...level.values()), owners }
}

export function mapDepth(text, root) {
  return wholeMap(text, { root }).levels
}

function mapNode(map, id) {
  const owner = map.owners.nodes.get(id)
  if (owner == null) throw new DotEditError("That can't be edited from the whole map")
  return owner
}

function mapBox(map, id) {
  if (id == null) return null
  const owner = map.owners.boxes.get(id)
  if (owner == null) throw new DotEditError("That box can't be edited from the whole map")
  return owner
}

function mapEdge(map, edge) {
  const found = map.owners.edges.find(candidate => candidate.from === edge.from && candidate.to === edge.to && candidate.index === (edge.index ?? 0))
  if (found == null) throw new DotEditError("That arrow can't be edited from the whole map")
  return found.source
}

function sameView(owners) {
  const view = owners[0].view
  if (owners.some(owner => owner.view !== view)) throw new DotEditError('Those are in different views; open one view to do that')
  return view
}

function endpoint(map, end, text = null) {
  if (typeof end === 'string') return { ...mapNode(map, end), kind: 'node' }
  const box = mapBox(map, end.cluster)
  if (!box.group) return { view: box.view, kind: 'box', cluster: box.cluster }
  const parent = text == null ? null : views(text).find(view => view.id === box.view)?.parent
  if (parent != null) {
    const model = describe(text, { graph: parent })
    const opener = [...model.nodes.values()].find(node => !isGhost(node) && linkTarget(node.attrs.URL) === box.view)
    if (opener != null) return { view: parent, kind: 'node', node: opener.id, opens: box.view }
    const holder = [...model.subgraphs.values()].find(subgraph => subgraph.isCluster && linkTarget(subgraph.attrs.URL) === box.view)
    if (holder != null) return { view: parent, kind: 'box', cluster: holder.id, opens: box.view }
  }
  return { view: box.view, kind: 'group' }
}

function destination(map, view, to) {
  const box = mapBox(map, to)
  if (box == null) return view === map.root ? null : (() => { throw new DotEditError('Moving between views isn\'t supported yet') })()
  if (box.view !== view) throw new DotEditError('Moving between views isn\'t supported yet')
  return box.group ? null : box.cluster
}

export function routeMapEdit(text, map, edit) {
  const route = inner => routeMapEdit(text, map, inner)
  switch (edit.type) {
    case 'batch': {
      const nodes = new Map(map.owners.nodes)
      const taken = []
      for (const inner of edit.edits) {
        if (inner.type !== 'addNode' || nodes.has(inner.node)) continue
        const partner = edit.edits.find(other => other.type === 'addEdge' && (other.from === inner.node || other.to === inner.node))
        const other = partner == null ? null : partner.from === inner.node ? partner.to : partner.from
        const box = mapBox(map, inner.subgraph ?? (other != null && typeof other === 'object' ? other.cluster : null))
        const view = inner.subgraph == null && typeof other === 'string' ? mapNode({ owners: { nodes } }, other).view : box?.view ?? map.root
        const node = newNodeId(text, { taken })
        taken.push(node)
        nodes.set(inner.node, { view, node, cluster: inner.subgraph != null && box != null && !box.group ? box.cluster : undefined, created: true })
      }
      const within = { ...map, owners: { ...map.owners, nodes } }
      return { type: 'batch', edits: edit.edits.map(inner => routeMapEdit(text, within, inner)).flatMap(routed => (routed.type === 'batch' ? routed.edits : [routed])) }
    }
    case 'setNodeAttr':
    case 'removeNode':
    case 'leaveRow': {
      const owner = mapNode(map, edit.node)
      return { ...edit, graph: owner.view, node: owner.node }
    }
    case 'setEdgeAttr':
    case 'removeEdge': {
      const source = mapEdge(map, edit.edge)
      return { ...edit, graph: source.view, edge: { from: source.from, to: source.to, index: source.index } }
    }
    case 'setGraphAttr': {
      const box = mapBox(map, edit.subgraph)
      if (box == null) return { ...edit, graph: map.root, subgraph: undefined }
      if (box.group) return { ...edit, graph: box.view, subgraph: undefined, key: edit.key === 'label' ? 'title' : edit.key }
      return { ...edit, graph: box.view, subgraph: box.cluster }
    }
    case 'addNode': {
      const created = map.owners.nodes.get(edit.node)
      if (created?.created) return { ...edit, graph: created.view, node: created.node, subgraph: created.cluster }
      const box = mapBox(map, edit.subgraph)
      const view = box?.view ?? map.root
      return { ...edit, graph: view, node: newNodeId(text, { graph: view }), subgraph: box == null || box.group ? undefined : box.cluster }
    }
    case 'addEdge': {
      const tail = endpoint(map, edit.from, text)
      const head = endpoint(map, edit.to, text)
      if (tail.kind === 'group' || head.kind === 'group') throw new DotEditError('That view has nothing that opens it to connect to; connect to a node inside it')
      if (tail.opens != null && head.view === tail.opens || head.opens != null && tail.view === head.opens) {
        throw new DotEditError("Graphviz can't draw an arrow from inside a box to its own border")
      }
      const ref = end => (end.kind === 'box' ? { cluster: end.cluster } : end.node)
      if (tail.view === head.view) return { ...edit, graph: tail.view, from: ref(tail), to: ref(head) }
      if (tail.kind !== 'node') throw new DotEditError('Connect from a node in that view, not its box')
      const edits = []
      const present = describe(text, { graph: head.view }).nodes.get(tail.node)
      if (present != null && !(isGhost(present) && linkTarget(present.attrs.URL) === tail.view)) {
        const titleOf = id => views(text).find(view => view.id === id)?.title ?? id
        throw new DotEditError(`"${titleOf(head.view)}" already has its own node with the id "${tail.node}"; rename one of them in Show DOT, then connect again`)
      }
      if (present == null) edits.push({ type: 'addGhost', graph: head.view, node: tail.node, from: tail.view })
      edits.push({ type: 'addEdge', graph: head.view, from: tail.node, to: ref(head), attrs: edit.attrs })
      return edits.length === 1 ? edits[0] : { type: 'batch', edits }
    }
    case 'moveNode': {
      const owner = mapNode(map, edit.node)
      const box = mapBox(map, edit.to)
      const view = box?.view ?? map.root
      const cluster = box == null || box.group ? null : box.cluster
      if (view === owner.view) return { ...edit, graph: view, node: owner.node, to: cluster }
      return moveToView(text, { from: owner.view, node: owner.node, to: view, cluster })
    }
    case 'moveCluster': {
      const box = mapBox(map, edit.cluster)
      if (box.group) throw new DotEditError('Open the view to move it')
      return { ...edit, graph: box.view, cluster: box.cluster, to: destination(map, box.view, edit.to) }
    }
    case 'placeInRow': {
      const owner = mapNode(map, edit.node)
      const other = mapNode(map, edit.target)
      const view = sameView([owner, other])
      return { ...edit, graph: view, node: owner.node, target: other.node }
    }
    case 'addCluster': {
      const nodes = (edit.nodes ?? []).map(id => mapNode(map, id))
      const boxes = (edit.clusters ?? []).map(id => mapBox(map, id))
      if (boxes.some(box => box.group)) throw new DotEditError('Open the view to group it')
      const within = mapBox(map, edit.subgraph)
      const owners = [...nodes, ...boxes, ...(within != null ? [within] : [])]
      const view = owners.length === 0 ? map.root : sameView(owners)
      return {
        ...edit,
        graph: view,
        nodes: nodes.map(owner => owner.node),
        clusters: boxes.map(box => box.cluster),
        subgraph: within == null || within.group ? undefined : within.cluster,
      }
    }
    default:
      throw new DotEditError("That can't be done from the whole map yet; open the view first")
  }
}

export function parseLegend(value) {
  if (typeof value !== 'string' || value.trim() === '') return []
  const separator = value.includes(';') ? ';' : ','
  return value
    .split(separator)
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const colon = part.indexOf(':')
      const name = (colon < 0 ? part : part.slice(0, colon)).trim()
      let label = colon < 0 ? '' : part.slice(colon + 1).trim()
      const color = /\s(#[0-9a-f]{3,8})$/i.exec(` ${label}`)?.[1] ?? null
      if (color != null) label = label.slice(0, -color.length).trim()
      return { name, label, color }
    })
}

export function formatLegend(entries) {
  const separator = entries.some(entry => entry.label.includes(',')) ? '; ' : ', '
  return entries.map(entry => `${entry.name}: ${entry.label}${entry.color ? ` ${entry.color}` : ''}`).join(separator)
}

export function legend(text) {
  const entries = new Map()
  for (const view of views(text)) {
    for (const entry of parseLegend(describe(text, { graph: view.index }).attrs.legend)) {
      if (!entries.has(entry.name)) entries.set(entry.name, { ...entry, view: view.id })
    }
  }
  return entries
}

export function classesInUse(text, { only = null, palette = DEFAULT_PALETTE } = {}) {
  const used = new Set()
  const add = value => {
    for (const name of String(value ?? '').split(/\s+/)) if (name !== '' && name !== 'ghost') used.add(name)
  }
  const byColor = (...colors) => {
    for (const color of colors) {
      if (typeof color !== 'string') continue
      const entry = palette.find(candidate => [candidate.fill.light, candidate.line.light].some(value => value.toLowerCase() === color.toLowerCase()))
      if (entry != null) used.add(entry.class)
    }
  }
  const models = new Map(views(text).map(view => [view.id, describe(text, { graph: view.index })]))
  for (const [id, model] of models) {
    if (only != null && !only.includes(id)) continue
    for (const node of model.nodes.values()) {
      const look = isGhost(node) ? models.get(linkTarget(node.attrs.URL))?.nodes.get(node.id)?.attrs ?? {} : node.attrs
      add(look.class)
      byColor(look.fillcolor, look.color)
    }
    for (const edge of model.edges) {
      add(edge.attrs.class)
      byColor(edge.attrs.color)
    }
    for (const subgraph of model.subgraphs.values()) {
      add(subgraph.attrs.class)
      byColor(subgraph.attrs.bgcolor, subgraph.attrs.color)
    }
  }
  return used
}

export function legendEdit(text, name, label) {
  const existing = legend(text).get(name)
  const list = views(text)
  const home = existing?.view ?? (list.find(view => view.parent == null) ?? list[0]).id
  const current = parseLegend(describe(text, { graph: home }).attrs.legend)
  const value = label.trim()
  let next
  if (value === '') next = current.filter(entry => entry.name !== name)
  else if (current.some(entry => entry.name === name)) next = current.map(entry => (entry.name === name ? { ...entry, label: value } : entry))
  else next = [...current, { name, label: value, color: null }]
  return { type: 'setGraphAttr', graph: home, key: 'legend', value: next.length === 0 ? null : formatLegend(next) }
}

export function repairGhosts(text) {
  const list = views(text)
  const models = new Map(list.map(view => [view.id, describe(text, { graph: view.id })]))
  const edits = []
  for (const [viewId, model] of models) {
    for (const node of model.nodes.values()) {
      if (!isGhost(node)) continue
      const target = linkTarget(node.attrs.URL)
      const there = models.get(target)?.nodes.get(node.id)
      if (there != null && !isGhost(there)) continue
      const home = [...models].find(([id, other]) => id !== viewId && other.nodes.has(node.id) && !isGhost(other.nodes.get(node.id)))?.[0]
      if (home != null && home !== target) edits.push({ type: 'setNodeAttr', graph: viewId, node: node.id, key: 'URL', value: `#${home}` })
    }
  }
  return edits.length === 0 ? null : { type: 'batch', edits }
}

export function moveToView(text, { from, node, to, cluster = null }) {
  const source = describe(text, { graph: from })
  const original = source.nodes.get(node)
  if (original == null) throw new DotEditError(`There is no node "${node}" in "${from}"`)
  if (isGhost(original)) throw new DotEditError('That is a ghost; move the node in its own view')
  const target = describe(text, { graph: to })
  const there = target.nodes.get(node)
  if (there != null && !(isGhost(there) && linkTarget(there.attrs.URL) === from)) {
    throw new DotEditError(`That view already has its own node with the id "${node}"; rename one of them in Show DOT first`)
  }
  const attrs = { ...original.attrs }
  const edits = []
  if (original.row != null) edits.push({ type: 'leaveRow', graph: from, node })
  const realNode = id => {
    const found = source.nodes.get(id)
    return found != null && !String(found.attrs.style ?? '').includes('invis')
  }
  const incoming = source.edges.filter(edge => edge.to === node && edge.from !== node && realNode(edge.from))
  const staying = source.edges.filter(edge => (edge.from === node || edge.to === node) && !incoming.includes(edge))
  for (const edge of [...incoming].sort((x, y) => y.index - x.index)) {
    edits.push({ type: 'removeEdge', graph: from, edge: { from: edge.from, to: edge.to, index: edge.index } })
  }
  const arriving = []
  const ghosted = new Set()
  for (const edge of incoming) {
    const present = target.nodes.get(edge.from)
    if (present == null && !ghosted.has(edge.from)) {
      ghosted.add(edge.from)
      const home = isGhost(source.nodes.get(edge.from)) ? linkTarget(source.nodes.get(edge.from).attrs.URL) : from
      arriving.push({ type: 'addNode', graph: to, node: edge.from, attrs: { label: source.nodes.get(edge.from).attrs.label, class: 'ghost', URL: `#${home}` } })
    }
    const edgeAttrs = { ...edge.attrs }
    delete edgeAttrs.lhead
    delete edgeAttrs.ltail
    arriving.push({ type: 'addEdge', graph: to, from: edge.from, to: node, attrs: edgeAttrs })
  }
  if (staying.length > 0) {
    edits.push({ type: 'moveNode', graph: from, node, to: null })
    for (const key of Object.keys(attrs)) if (key !== 'label') edits.push({ type: 'setNodeAttr', graph: from, node, key, value: null })
    edits.push({ type: 'setNodeAttr', graph: from, node, key: 'class', value: 'ghost' })
    edits.push({ type: 'setNodeAttr', graph: from, node, key: 'URL', value: `#${to}` })
  } else edits.push({ type: 'removeNode', graph: from, node })
  if (there != null) {
    for (const key of new Set([...Object.keys(there.attrs), ...Object.keys(attrs)])) {
      edits.push({ type: 'setNodeAttr', graph: to, node, key, value: attrs[key] ?? null })
    }
    if (cluster != null) edits.push({ type: 'moveNode', graph: to, node, to: cluster })
  } else edits.push({ type: 'addNode', graph: to, node, attrs, subgraph: cluster ?? undefined })
  edits.push(...arriving)
  for (const view of views(text)) {
    if (view.id === from || view.id === to) continue
    const copy = describe(text, { graph: view.id }).nodes.get(node)
    if (copy != null && isGhost(copy) && linkTarget(copy.attrs.URL) === from) {
      edits.push({ type: 'setNodeAttr', graph: view.id, node, key: 'URL', value: `#${to}` })
    }
  }
  const opens = linkTarget(attrs.URL)
  if (opens != null && views(text).find(view => view.id === opens)?.parent === from) {
    edits.push({ type: 'setGraphAttr', graph: opens, key: 'parent', value: to })
  }
  return { type: 'batch', edits }
}

export function renameIdsWithLabels(text, edit) {
  const flat = edit.type === 'batch' ? edit.edits : [edit]
  const list = views(text)
  const renames = []
  const taken = []
  const seen = new Set()
  for (const inner of flat) {
    if (inner.type !== 'setNodeAttr' || inner.key !== 'label' || inner.value == null || seen.has(inner.node)) continue
    const node = describe(text, { graph: inner.graph }).nodes.get(inner.node)
    if (node == null || isGhost(node)) continue
    seen.add(inner.node)
    const base = nodeSlug(inner.value)
    if (inner.node === base || new RegExp(`^${base}_\\d+$`).test(inner.node)) continue
    if (!isGeneratedId(inner.node, node.attrs.label ?? inner.node)) continue
    const to = newNodeId(text, { label: inner.value, taken })
    taken.push(to)
    for (const view of list) {
      if (describe(text, { graph: view.id }).nodes.has(inner.node)) renames.push({ type: 'renameNode', graph: view.id, node: inner.node, to })
    }
  }
  if (renames.length === 0) return edit
  return { type: 'batch', edits: [...flat, ...renames] }
}

export function impliedEdit(text, edit) {
  let full = edit
  if (edit.type === 'setNodeAttr' && edit.key === 'label') {
    const copies = copiesOf(text, edit.graph, edit.node)
    if (copies.length > 0) full = { type: 'batch', edits: [edit, ...copies.map(copy => ({ ...edit, graph: copy.view, node: copy.node }))] }
  }
  return renameIdsWithLabels(text, expandEdit(text, full))
}
