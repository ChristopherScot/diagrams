const KEYWORDS = new Set(['strict', 'graph', 'digraph', 'node', 'edge', 'subgraph'])
const BARE = /[A-Za-z_\u0080-￿][\w\u0080-￿]*|-?(?:\.\d+|\d+(?:\.\d*)?)/y
const BARE_SAFE = /^(?:[A-Za-z_\u0080-￿][\w\u0080-￿]*|-?(?:\.\d+|\d+(?:\.\d*)?))$/

export class DotSyntaxError extends Error {
  constructor(message, offset, text) {
    const before = text.slice(0, offset)
    const line = before.split('\n').length
    const column = offset - before.lastIndexOf('\n')
    super(`${message} (line ${line}, column ${column})`)
    this.name = 'DotSyntaxError'
    this.offset = offset
    this.line = line
    this.column = column
  }
}

export class DotEditError extends Error {
  constructor(message) {
    super(message)
    this.name = 'DotEditError'
  }
}

function lineEnd(text, i) {
  const end = text.indexOf('\n', i)
  return end < 0 ? text.length : end
}

function skipString(text, i) {
  for (let j = i + 1; j < text.length; j += 1) {
    if (text[j] === '\\') j += 1
    else if (text[j] === '"') return j + 1
  }
  throw new DotSyntaxError('Unclosed string', i, text)
}

function skipHtml(text, i) {
  let depth = 0
  for (let j = i; j < text.length; j += 1) {
    if (text[j] === '<') depth += 1
    else if (text[j] === '>') {
      depth -= 1
      if (depth === 0) return j + 1
    }
  }
  throw new DotSyntaxError('Unclosed HTML label', i, text)
}

function unescapeString(raw) {
  return raw.replace(/\\\r?\n/g, '').replace(/\\"/g, '"')
}

function tokenize(text) {
  const tokens = []
  let lineStart = true
  for (let i = 0; i < text.length; ) {
    const character = text[i]
    if (character === '\n') {
      lineStart = true
      i += 1
      continue
    }
    if (/\s/.test(character)) {
      i += 1
      continue
    }
    if (character === '#' && lineStart) {
      i = lineEnd(text, i)
      continue
    }
    lineStart = false
    if (character === '/' && text[i + 1] === '/') {
      i = lineEnd(text, i)
      continue
    }
    if (character === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      if (end < 0) throw new DotSyntaxError('Unclosed comment', i, text)
      i = end + 2
      continue
    }
    if (character === '"') {
      const end = skipString(text, i)
      tokens.push({ type: 'id', quoted: true, value: unescapeString(text.slice(i + 1, end - 1)), start: i, end })
      i = end
      continue
    }
    if (character === '<') {
      const end = skipHtml(text, i)
      tokens.push({ type: 'id', html: true, value: text.slice(i + 1, end - 1), start: i, end })
      i = end
      continue
    }
    if (character === '-' && (text[i + 1] === '>' || text[i + 1] === '-')) {
      tokens.push({ type: 'edgeop', value: text.slice(i, i + 2), start: i, end: i + 2 })
      i += 2
      continue
    }
    if ('{}[];,=:+'.includes(character)) {
      tokens.push({ type: character, start: i, end: i + 1 })
      i += 1
      continue
    }
    BARE.lastIndex = i
    const match = BARE.exec(text)
    if (match == null) throw new DotSyntaxError(`Unexpected character "${character}"`, i, text)
    const word = match[0]
    const keyword = KEYWORDS.has(word.toLowerCase()) ? word.toLowerCase() : null
    tokens.push(
      keyword == null
        ? { type: 'id', value: word, start: i, end: i + word.length }
        : { type: 'keyword', value: keyword, start: i, end: i + word.length }
    )
    i += word.length
  }
  return tokens
}

export function parse(text) {
  const tokens = tokenize(text)
  let p = 0
  let kind = 'digraph'
  const describeToken = token => (token == null ? 'end of file' : `"${text.slice(token.start, token.end)}"`)
  const fail = (message, token) => {
    throw new DotSyntaxError(`${message}, found ${describeToken(token)}`, token == null ? text.length : token.start, text)
  }
  const isKeyword = (token, value) => token?.type === 'keyword' && token.value === value
  const startsSubgraph = token => token?.type === '{' || isKeyword(token, 'subgraph')
  const expect = type => {
    const token = tokens[p]
    if (token?.type !== type) fail(`Expected "${type}"`, token)
    p += 1
    return token
  }

  function readId() {
    const token = tokens[p]
    if (token?.type !== 'id') fail('Expected a name or value', token)
    p += 1
    const id = { value: token.value, start: token.start, end: token.end, quoted: token.quoted === true, html: token.html === true }
    while (id.quoted && tokens[p]?.type === '+' && tokens[p + 1]?.quoted) {
      id.value += tokens[p + 1].value
      id.end = tokens[p + 1].end
      p += 2
    }
    return id
  }

  function attrLists() {
    const lists = []
    while (tokens[p]?.type === '[') {
      const open = tokens[p]
      p += 1
      const items = []
      while (tokens[p] != null && tokens[p].type !== ']') {
        const key = readId()
        let value = null
        if (tokens[p]?.type === '=') {
          p += 1
          value = readId()
        }
        items.push({ key, value, start: key.start, end: (value ?? key).end })
        if (tokens[p]?.type === ',' || tokens[p]?.type === ';') p += 1
      }
      const close = expect(']')
      lists.push({ start: open.start, end: close.end, items })
    }
    return lists
  }

  function nodeOperand() {
    const id = readId()
    const port = []
    while (tokens[p]?.type === ':') {
      p += 1
      port.push(readId())
    }
    return { kind: 'node', id, port, start: id.start, end: (port.at(-1) ?? id).end }
  }

  function subgraph() {
    const start = tokens[p].start
    let id = null
    if (isKeyword(tokens[p], 'subgraph')) {
      p += 1
      if (tokens[p]?.type === 'id') id = readId()
    }
    const open = expect('{')
    const body = statements()
    const close = expect('}')
    return { type: 'subgraph', kind: 'subgraph', id, open: open.start, close: close.start, body, start, end: close.end }
  }

  function statement() {
    const token = tokens[p]
    if (token.type === 'keyword' && ['graph', 'node', 'edge'].includes(token.value) && tokens[p + 1]?.type === '[') {
      p += 1
      const lists = attrLists()
      return { type: 'attr', target: token.value, lists, start: token.start, end: lists.at(-1).end }
    }
    if (token.type === 'id' && tokens[p + 1]?.type === '=') {
      const key = readId()
      p += 1
      const value = readId()
      return { type: 'assign', key, value, start: key.start, end: value.end }
    }
    let first
    if (startsSubgraph(token)) first = subgraph()
    else if (token.type === 'id') first = nodeOperand()
    else fail('Expected a statement', token)
    if (tokens[p]?.type === 'edgeop') {
      const operands = [first]
      const expected = kind === 'digraph' ? '->' : '--'
      while (tokens[p]?.type === 'edgeop') {
        if (tokens[p].value !== expected) fail(`Expected "${expected}" in a ${kind}`, tokens[p])
        p += 1
        operands.push(startsSubgraph(tokens[p]) ? subgraph() : nodeOperand())
      }
      const lists = attrLists()
      return { type: 'edge', operands, lists, start: first.start, end: (lists.at(-1) ?? operands.at(-1)).end }
    }
    if (first.kind === 'subgraph') return first
    const lists = attrLists()
    return { type: 'node', id: first.id, port: first.port, lists, start: first.start, end: (lists.at(-1) ?? first).end }
  }

  function statements() {
    const body = []
    while (tokens[p] != null && tokens[p].type !== '}') {
      const item = statement()
      item.stop = item.end
      if (tokens[p]?.type === ';') {
        item.stop = tokens[p].end
        p += 1
      }
      body.push(item)
    }
    return body
  }

  const graphs = []
  while (p < tokens.length) {
    const start = tokens[p].start
    let strict = false
    if (isKeyword(tokens[p], 'strict')) {
      strict = true
      p += 1
    }
    const head = tokens[p]
    if (!isKeyword(head, 'graph') && !isKeyword(head, 'digraph')) fail('Expected "graph" or "digraph"', head)
    p += 1
    kind = head.value
    const id = tokens[p]?.type === 'id' ? readId() : null
    const open = expect('{')
    const body = statements()
    const close = expect('}')
    graphs.push({ type: 'graph', kind, strict, id, open: open.start, close: close.start, body, start, end: close.end })
  }
  return { text, graphs }
}

function* walk(body) {
  for (const item of body) {
    yield item
    if (item.type === 'subgraph') yield* walk(item.body)
    if (item.type === 'edge') {
      for (const operand of item.operands) {
        if (operand.kind === 'subgraph') {
          yield operand
          yield* walk(operand.body)
        }
      }
    }
  }
}

function pickGraph(document, graph) {
  if (document.graphs.length === 0) throw new DotEditError('The text has no graph')
  if (graph == null) return document.graphs[0]
  if (typeof graph === 'number') {
    const found = document.graphs[graph]
    if (found == null) throw new DotEditError(`There is no graph number ${graph}`)
    return found
  }
  const found = document.graphs.find(candidate => candidate.id?.value === graph)
  if (found == null) throw new DotEditError(`There is no graph named "${graph}"`)
  return found
}

function findSubgraph(graph, id) {
  if (id == null) return graph
  for (const item of walk(graph.body)) if (item.type === 'subgraph' && item.id?.value === id) return item
  throw new DotEditError(`There is no subgraph named "${id}"`)
}

function operandNodes(operand) {
  if (operand.kind === 'node') return [operand.id.value]
  const names = []
  for (const item of walk(operand.body)) {
    if (item.type === 'node') names.push(item.id.value)
    if (item.type === 'edge') for (const inner of item.operands) if (inner.kind === 'node') names.push(inner.id.value)
  }
  return [...new Set(names)]
}

function nodeNames(graph, skip = null) {
  const names = new Set()
  for (const item of walk(graph.body)) {
    if (item === skip) continue
    if (item.type === 'node') names.add(item.id.value)
    if (item.type === 'edge') for (const operand of item.operands) if (operand.kind === 'node') names.add(operand.id.value)
  }
  return names
}

function edgeList(graph) {
  const edges = []
  const counts = new Map()
  for (const item of walk(graph.body)) {
    if (item.type !== 'edge') continue
    for (let k = 0; k + 1 < item.operands.length; k += 1) {
      const simple = item.operands[k].kind === 'node' && item.operands[k + 1].kind === 'node'
      for (const from of operandNodes(item.operands[k])) {
        for (const to of operandNodes(item.operands[k + 1])) {
          const pair = `${from}\u0000${to}`
          const index = counts.get(pair) ?? 0
          counts.set(pair, index + 1)
          edges.push({ from, to, index, statement: item, link: k, simple })
        }
      }
    }
  }
  return edges
}

function findEdge(graph, edge) {
  const index = edge.index ?? 0
  const found = edgeList(graph).find(candidate => candidate.from === edge.from && candidate.to === edge.to && candidate.index === index)
  if (found == null) throw new DotEditError(`There is no edge ${edge.from} → ${edge.to} (number ${index})`)
  return found
}

export function formatId(value) {
  if (BARE_SAFE.test(value) && !KEYWORDS.has(value.toLowerCase())) return value
  return `"${value.replace(/"/g, '\\"')}"`
}

export function formatValue(value) {
  if (value != null && typeof value === 'object' && 'html' in value) return `<${value.html}>`
  return formatId(String(value))
}

function formatAttrs(attrs) {
  const entries = Object.entries(attrs ?? {}).filter(([, value]) => value != null)
  return entries.length === 0 ? '' : ` [${entries.map(([key, value]) => `${formatId(key)}=${formatValue(value)}`).join(', ')}]`
}

function attrValue(id) {
  return id.html ? { html: id.value } : id.value
}

function readAttrs(lists, into = {}) {
  for (const list of lists) for (const item of list.items) into[item.key.value] = item.value == null ? 'true' : attrValue(item.value)
  return into
}

function splice(text, start, end, insert = '') {
  return text.slice(0, start) + insert + text.slice(end)
}

function lineIndent(text, offset) {
  const start = text.lastIndexOf('\n', offset - 1) + 1
  return /^[ \t]*/.exec(text.slice(start))[0]
}

function bodyIndent(text, container) {
  const first = container.body[0]
  if (first != null && text.slice(container.open, first.start).includes('\n')) return lineIndent(text, first.start)
  return `${lineIndent(text, container.open)}  `
}

function endInsertion(text, container, lines) {
  const indent = bodyIndent(text, container)
  const body = lines.map(line => `${indent}${line}`).join('\n')
  const lineStart = text.lastIndexOf('\n', container.close - 1) + 1
  if (lineStart > container.open && /^[ \t]*$/.test(text.slice(lineStart, container.close))) {
    return { start: lineStart, end: lineStart, insert: `${body}\n` }
  }
  return { start: container.close, end: container.close, insert: `\n${body}\n` }
}

function applyOps(text, ops) {
  return [...ops]
    .sort((a, b) => b.start - a.start || b.end - a.end)
    .reduce((current, op) => splice(current, op.start, op.end, op.insert), text)
}

function insertAtEnd(text, container, line) {
  return applyOps(text, [endInsertion(text, container, [line])])
}

function insertAtStart(text, container, line) {
  const indent = bodyIndent(text, container)
  return splice(text, container.open + 1, container.open + 1, `\n${indent}${line}`)
}

function statementRemoval(text, item, replacement = []) {
  const lineStart = text.lastIndexOf('\n', item.start - 1) + 1
  const end = lineEnd(text, item.stop)
  const aloneOnLine = /^[ \t]*$/.test(text.slice(lineStart, item.start)) && /^[ \t]*$/.test(text.slice(item.stop, end))
  if (replacement.length > 0) {
    const indent = lineIndent(text, item.start)
    return { start: item.start, end: item.stop, insert: replacement.join(`\n${indent}`) }
  }
  if (aloneOnLine) return { start: lineStart, end: Math.min(end + 1, text.length), insert: '' }
  let stop = item.stop
  while (text[stop] === ' ' || text[stop] === '\t') stop += 1
  return { start: item.start, end: stop, insert: '' }
}

function removeStatement(text, item, replacement = []) {
  return applyOps(text, [statementRemoval(text, item, replacement)])
}

function separatorFor(text, list) {
  if (list.items.length < 2) return ', '
  const between = text.slice(list.items[0].end, list.items[1].start)
  return between.includes(',') ? ', ' : between.includes(';') ? '; ' : ' '
}

function setInLists(text, lists, insertAt, key, value) {
  let found = null
  for (const list of lists) for (const item of list.items) if (item.key.value === key) found = { list, item }
  if (found != null) {
    const { list, item } = found
    if (value == null) {
      const position = list.items.indexOf(item)
      const next = list.items[position + 1]
      const previous = list.items[position - 1]
      if (next != null) return splice(text, item.start, next.start)
      if (previous != null) return splice(text, previous.end, item.end)
      let start = list.start
      while (start > 0 && (text[start - 1] === ' ' || text[start - 1] === '\t')) start -= 1
      return splice(text, start, list.end)
    }
    if (item.value == null) return splice(text, item.key.end, item.key.end, `=${formatValue(value)}`)
    return splice(text, item.value.start, item.value.end, formatValue(value))
  }
  if (value == null) return text
  const pair = `${formatId(key)}=${formatValue(value)}`
  const list = lists.at(-1)
  if (list == null) return splice(text, insertAt, insertAt, ` [${pair}]`)
  if (list.items.length === 0) return splice(text, list.start + 1, list.start + 1, pair)
  return splice(text, list.items.at(-1).end, list.items.at(-1).end, `${separatorFor(text, list)}${pair}`)
}

function hasKey(lists, key) {
  return lists.some(list => list.items.some(item => item.key.value === key))
}

export function setNodeAttr(text, { graph, node, key, value }) {
  const target = pickGraph(parse(text), graph)
  const declarations = [...walk(target.body)].filter(item => item.type === 'node' && item.id.value === node)
  const withKey = declarations.filter(item => hasKey(item.lists, key))
  const declaration = withKey.at(-1) ?? declarations.at(-1)
  if (declaration != null) return setInLists(text, declaration.lists, declaration.end, key, value)
  if (!nodeNames(target).has(node)) throw new DotEditError(`There is no node "${node}"`)
  if (value == null) return text
  return insertAtEnd(text, target, `${formatId(node)}${formatAttrs({ [key]: value })}`)
}

export function setGraphAttr(text, { graph, subgraph, key, value }) {
  const container = findSubgraph(pickGraph(parse(text), graph), subgraph)
  let found = null
  for (const item of container.body) {
    if (item.type === 'assign' && item.key.value === key) found = item
    if (item.type === 'attr' && item.target === 'graph' && hasKey(item.lists, key)) found = item
  }
  if (found?.type === 'attr') return setInLists(text, found.lists, found.end, key, value)
  if (found != null) {
    if (value == null) return removeStatement(text, found)
    return splice(text, found.value.start, found.value.end, formatValue(value))
  }
  if (value == null) return text
  return insertAtStart(text, container, `${formatId(key)}=${formatValue(value)}`)
}

function isolateEdge(text, graph, edge) {
  const found = findEdge(graph, edge)
  const item = found.statement
  if (item.operands.length === 2 && found.simple) return text
  if (!found.simple) throw new DotEditError(`The edge ${edge.from} → ${edge.to} comes from a subgraph group; edit it in the DOT text`)
  if (item.operands.some(operand => operand.kind !== 'node')) {
    throw new DotEditError(`The edge ${edge.from} → ${edge.to} shares a statement with a subgraph group; edit it in the DOT text`)
  }
  const op = graph.kind === 'digraph' ? ' -> ' : ' -- '
  const operandText = item.operands.map(operand => text.slice(operand.start, operand.end))
  const listText = item.lists.length === 0 ? '' : ` ${item.lists.map(list => text.slice(list.start, list.end)).join(' ')}`
  const k = found.link
  const pieces = []
  if (k > 0) pieces.push(operandText.slice(0, k + 1))
  pieces.push(operandText.slice(k, k + 2))
  if (k + 2 < operandText.length) pieces.push(operandText.slice(k + 1))
  const indent = lineIndent(text, item.start)
  return splice(text, item.start, item.end, pieces.map(piece => piece.join(op) + listText).join(`\n${indent}`))
}

export function setEdgeAttr(text, { graph, edge, key, value }) {
  const isolated = isolateEdge(text, pickGraph(parse(text), graph), edge)
  const found = findEdge(pickGraph(parse(isolated), graph), edge)
  return setInLists(isolated, found.statement.lists, found.statement.end, key, value)
}

function deleteEdge(text, graph, edge, removing) {
  const isolated = isolateEdge(text, pickGraph(parse(text), graph), edge)
  const target = pickGraph(parse(isolated), graph)
  const found = findEdge(target, edge)
  const remaining = nodeNames(target, found.statement)
  const orphans = [...new Set([found.from, found.to])].filter(name => name !== removing && !remaining.has(name))
  return removeStatement(isolated, found.statement, orphans.map(formatId))
}

export function removeEdge(text, { graph, edge }) {
  return deleteEdge(text, graph, edge, null)
}

export function removeNode(text, { graph, node }) {
  let current = leaveRow(text, { graph, node })
  for (let guard = 0; ; guard += 1) {
    const target = pickGraph(parse(current), graph)
    const edge = edgeList(target).find(candidate => candidate.from === node || candidate.to === node)
    if (edge == null) break
    if (guard > 10000) throw new DotEditError(`Could not remove the edges of "${node}"`)
    current = deleteEdge(current, graph, edge, node)
  }
  for (;;) {
    const target = pickGraph(parse(current), graph)
    const declaration = [...walk(target.body)].find(item => item.type === 'node' && item.id.value === node)
    if (declaration == null) break
    current = removeStatement(current, declaration)
  }
  if (current === text) throw new DotEditError(`There is no node "${node}"`)
  return current
}

export function addNode(text, { graph, subgraph, node, attrs }) {
  const target = pickGraph(parse(text), graph)
  if (nodeNames(target).has(node)) throw new DotEditError(`There is already a node "${node}"`)
  return insertAtEnd(text, findSubgraph(target, subgraph), `${formatId(node)}${formatAttrs(attrs)}`)
}

const ANCHOR_ATTRS = { shape: 'point', style: 'invis', width: '0', height: '0', label: '' }

export function anchorId(cluster) {
  return `${cluster}_anchor`
}

function endpoint(text, graph, end, key) {
  if (typeof end === 'string') return { text, node: end }
  const target = pickGraph(parse(text), graph)
  findCluster(target, end.cluster)
  const node = anchorId(end.cluster)
  const next = nodeNames(target).has(node) ? text : addNode(text, { graph, subgraph: end.cluster, node, attrs: ANCHOR_ATTRS })
  return { text: next, node, cluster: end.cluster, key }
}

function refuseLinkIntoItself(text, graph, tail, head) {
  const target = pickGraph(parse(text), graph)
  const mentions = nodeMentions(target)
  const inside = (node, cluster) => nodePath(mentions, node).some(item => item.id.value === cluster)
  if ((tail.cluster != null && inside(head.node, tail.cluster)) || (head.cluster != null && inside(tail.node, head.cluster))) {
    throw new DotEditError("A box can't be linked to itself or to something inside it")
  }
}

export function addEdge(text, { graph, subgraph, from, to, attrs }) {
  const tail = endpoint(text, graph, from, 'ltail')
  const head = endpoint(tail.text, graph, to, 'lhead')
  let current = head.text
  refuseLinkIntoItself(current, graph, tail, head)
  const compound = {}
  for (const end of [tail, head]) if (end.cluster != null) compound[end.key] = end.cluster
  if (Object.keys(compound).length > 0 && describe(current, { graph }).attrs.compound !== 'true') {
    current = setGraphAttr(current, { graph, key: 'compound', value: 'true' })
  }
  const target = pickGraph(parse(current), graph)
  const op = target.kind === 'digraph' ? '->' : '--'
  return insertAtEnd(current, findSubgraph(target, subgraph), `${formatId(tail.node)} ${op} ${formatId(head.node)}${formatAttrs({ ...compound, ...attrs })}`)
}

export function renameNode(text, { graph, node, to }) {
  const target = pickGraph(parse(text), graph)
  if (!nodeNames(target).has(node)) throw new DotEditError(`There is no node "${node}"`)
  if (to !== node && nodeNames(target).has(to)) throw new DotEditError(`There is already a node "${to}"`)
  const spans = []
  for (const item of walk(target.body)) {
    if (item.type === 'node' && item.id.value === node) spans.push(item.id)
    if (item.type === 'edge') for (const operand of item.operands) if (operand.kind === 'node' && operand.id.value === node) spans.push(operand.id)
  }
  return spans
    .sort((a, b) => b.start - a.start)
    .reduce((current, span) => splice(current, span.start, span.end, formatId(to)), text)
}

function isCluster(item) {
  return item.type === 'subgraph' && item.id != null && item.id.value.startsWith('cluster')
}

function nodeMentions(graph) {
  const mentions = []
  const visit = (body, chain) => {
    for (const item of body) {
      if (item.type === 'subgraph') visit(item.body, isCluster(item) ? [...chain, item] : chain)
      if (item.type === 'node') mentions.push({ node: item.id.value, chain, statement: item, viaEdge: false })
      if (item.type === 'edge') {
        for (const operand of item.operands) {
          if (operand.kind === 'node') mentions.push({ node: operand.id.value, chain, statement: item, viaEdge: true })
          else visit(operand.body, isCluster(operand) ? [...chain, operand] : chain)
        }
      }
    }
  }
  visit(graph.body, [])
  return mentions
}

function clusterChains(graph) {
  const chains = new Map()
  const visit = (body, chain) => {
    for (const item of body) {
      const subgraphs = item.type === 'subgraph' ? [item] : item.type === 'edge' ? item.operands.filter(operand => operand.kind === 'subgraph') : []
      for (const subgraph of subgraphs) {
        const next = isCluster(subgraph) ? [...chain, subgraph] : chain
        if (isCluster(subgraph)) chains.set(subgraph, next)
        visit(subgraph.body, next)
      }
    }
  }
  visit(graph.body, [])
  return chains
}

function findCluster(graph, id) {
  for (const item of walk(graph.body)) if (isCluster(item) && item.id.value === id) return item
  throw new DotEditError(`There is no box named "${id}"`)
}

function isPrefix(shorter, longer) {
  return shorter.length <= longer.length && shorter.every((item, index) => item === longer[index])
}

function nodePath(mentions, node) {
  const own = mentions.filter(mention => mention.node === node)
  if (own.length === 0) throw new DotEditError(`There is no node "${node}"`)
  return own.reduce((longest, mention) => (mention.chain.length > longest.length ? mention.chain : longest), [])
}

export function moveNode(text, { graph, node, to = null }) {
  const target = pickGraph(parse(text), graph)
  const destination = to == null ? null : findCluster(target, to)
  const destinationChain = destination == null ? [] : clusterChains(target).get(destination)
  const mentions = nodeMentions(target)
  nodePath(mentions, node)
  const own = mentions.filter(mention => mention.node === node)
  const ops = []
  const declarations = []
  const lifted = []
  const handled = new Set()
  for (const mention of own) {
    if (isPrefix(mention.chain, destinationChain) || handled.has(mention.statement)) continue
    const item = mention.statement
    handled.add(item)
    if (!mention.viaEdge) {
      declarations.push(text.slice(item.start, item.end))
      ops.push(statementRemoval(text, item))
      continue
    }
    if (item.operands.some(operand => operand.kind !== 'node')) {
      throw new DotEditError(`"${node}" is connected to a group of nodes inside a box; edit the DOT to move it`)
    }
    const home = mention.chain.at(-1)
    const others = [...new Set(item.operands.map(operand => operand.id.value))].filter(name => name !== node)
    const keep = others.filter(name => !mentions.some(other => other.node === name && other.statement !== item && other.chain.includes(home)))
    lifted.push(text.slice(item.start, item.end))
    ops.push(statementRemoval(text, item, keep.map(formatId)))
  }
  const alreadyThere = own.some(mention => handled.has(mention.statement) === false && mention.chain.length === destinationChain.length && isPrefix(mention.chain, destinationChain))
  if (declarations.length === 0 && !alreadyThere) declarations.push(formatId(node))
  if (ops.length === 0 && declarations.length === 0) return text
  if (destination == null) ops.push(endInsertion(text, target, [...declarations, ...lifted]))
  else {
    if (declarations.length > 0) ops.push(endInsertion(text, destination, declarations))
    if (lifted.length > 0) ops.push(endInsertion(text, target, lifted))
  }
  return applyOps(text, ops)
}

function reindent(block, from, to) {
  return block
    .split('\n')
    .map((line, index) => (index > 0 && line.startsWith(from) ? to + line.slice(from.length) : line))
    .join('\n')
}

export function moveCluster(text, { graph, cluster, to = null }) {
  const target = pickGraph(parse(text), graph)
  const item = findCluster(target, cluster)
  const chains = clusterChains(target)
  const parent = chains.get(item).at(-2) ?? null
  if ((parent?.id.value ?? null) === to) return text
  const destination = to == null ? null : findCluster(target, to)
  if (destination != null && chains.get(destination).includes(item)) {
    throw new DotEditError("A box can't be put inside itself or inside one of its own boxes")
  }
  if (!(parent ?? target).body.includes(item)) {
    throw new DotEditError(`The box "${cluster}" is part of a connection; edit the DOT to move it`)
  }
  const container = destination ?? target
  const block = reindent(text.slice(item.start, item.end), lineIndent(text, item.start), bodyIndent(text, container))
  const inside = new Set()
  for (const statement of walk(item.body)) {
    if (statement.type === 'node') inside.add(statement.id.value)
    if (statement.type === 'edge') for (const operand of statement.operands) if (operand.kind === 'node') inside.add(operand.id.value)
  }
  let result = applyOps(text, [statementRemoval(text, item), endInsertion(text, container, [block])])
  for (const node of inside) result = moveNode(result, { graph, node, to: cluster })
  return result
}

export function addCluster(text, { graph, cluster, nodes = [], clusters = [], subgraph, attrs }) {
  const target = pickGraph(parse(text), graph)
  if ([...walk(target.body)].some(item => item.type === 'subgraph' && item.id?.value === cluster)) {
    throw new DotEditError(`There is already a subgraph named "${cluster}"`)
  }
  if (nodes.length + clusters.length === 0) {
    const parent = findSubgraph(target, subgraph)
    const indent = bodyIndent(text, parent)
    const lines = Object.entries(attrs ?? {})
      .filter(([, value]) => value != null)
      .map(([key, value]) => `${formatId(key)}=${formatValue(value)}`)
    lines.push(`${formatId(anchorId(cluster))}${formatAttrs(ANCHOR_ATTRS)}`)
    return insertAtEnd(text, parent, [`subgraph ${formatId(cluster)} {`, ...lines.map(line => `${indent}  ${line}`), `${indent}}`].join('\n'))
  }
  const mentions = nodeMentions(target)
  const chains = clusterChains(target)
  const paths = [
    ...nodes.map(node => nodePath(mentions, node)),
    ...clusters.map(id => chains.get(findCluster(target, id)).slice(0, -1)),
  ]
  let shared = paths[0]
  for (const path of paths.slice(1)) {
    let k = 0
    while (k < shared.length && k < path.length && shared[k] === path[k]) k += 1
    shared = shared.slice(0, k)
  }
  const parent = shared.at(-1) ?? target
  const indent = bodyIndent(text, parent)
  const attrLines = Object.entries(attrs ?? {})
    .filter(([, value]) => value != null)
    .map(([key, value]) => `${indent}  ${formatId(key)}=${formatValue(value)}`)
  const block = [`subgraph ${formatId(cluster)} {`, ...attrLines, `${indent}}`].join('\n')
  let result = insertAtEnd(text, parent, block)
  for (const id of clusters) result = moveCluster(result, { graph, cluster: id, to: cluster })
  for (const node of nodes) result = moveNode(result, { graph, node, to: cluster })
  return result
}

export function newClusterId(text, { graph, prefix = 'cluster_' } = {}) {
  const names = new Set([...walk(pickGraph(parse(text), graph).body)].filter(item => item.type === 'subgraph').map(item => item.id?.value))
  for (let k = 1; ; k += 1) if (!names.has(`${prefix}${k}`)) return `${prefix}${k}`
}

const ROW_PREFIX = 'row_'

function isRow(item) {
  return item.type === 'subgraph' && item.id != null && item.id.value.startsWith(ROW_PREFIX)
}

function rowOrder(item) {
  const order = []
  for (const statement of item.body) {
    if (statement.type === 'node') order.push(statement.id.value)
    if (statement.type === 'edge') for (const operand of statement.operands) if (operand.kind === 'node') order.push(operand.id.value)
  }
  return [...new Set(order)]
}

function rowsOf(graph) {
  return graph.body.filter(isRow).map(item => ({ item, id: item.id.value, order: rowOrder(item) }))
}

function rowBlock(id, order, indent) {
  const inner = `${indent}  `
  const members = order.length > 1 ? `${order.map(formatId).join(' -> ')} [style=invis]` : formatId(order[0])
  return [`subgraph ${formatId(id)} {`, `${inner}rank=same`, `${inner}${members}`, `${indent}}`].join('\n')
}

function newRowId(graph) {
  const names = new Set([...walk(graph.body)].filter(item => item.type === 'subgraph').map(item => item.id?.value))
  for (let k = 1; ; k += 1) if (!names.has(`${ROW_PREFIX}${k}`)) return `${ROW_PREFIX}${k}`
}

function writeRows(text, graph, changes) {
  const ops = []
  const indent = bodyIndent(text, graph)
  for (const { row, order } of changes) {
    if (row == null) {
      if (order.length > 1) ops.push(endInsertion(text, graph, [rowBlock(newRowId(graph), order, indent)]))
      continue
    }
    if (order.length < 2) ops.push(statementRemoval(text, row.item))
    else ops.push({ start: row.item.start, end: row.item.end, insert: rowBlock(row.id, order, lineIndent(text, row.item.start)) })
  }
  return applyOps(text, ops)
}

function needsNewRank(text, graph) {
  const target = pickGraph(parse(text), graph)
  const mentions = nodeMentions(target)
  return rowsOf(target).some(row => row.order.some(node => nodePath(mentions, node).length > 0))
}

export function placeInRow(text, { graph, node, target: other, position = 'after' }) {
  if (node === other) throw new DotEditError("A node can't be lined up with itself")
  const target = pickGraph(parse(text), graph)
  const names = nodeNames(target)
  for (const name of [node, other]) if (!names.has(name)) throw new DotEditError(`There is no node "${name}"`)
  const rows = rowsOf(target)
  const from = rows.find(row => row.order.includes(node)) ?? null
  const into = rows.find(row => row.order.includes(other)) ?? null
  const order = (into?.order ?? [other]).filter(name => name !== node)
  order.splice(order.indexOf(other) + (position === 'before' ? 0 : 1), 0, node)
  const changes = [{ row: into, order }]
  if (from != null && from !== into) changes.push({ row: from, order: from.order.filter(name => name !== node) })
  let result = writeRows(text, target, changes)
  if (needsNewRank(result, graph) && describe(result, { graph }).attrs.newrank !== 'true') {
    result = setGraphAttr(result, { graph, key: 'newrank', value: 'true' })
  }
  return result
}

export function leaveRow(text, { graph, node }) {
  const target = pickGraph(parse(text), graph)
  const row = rowsOf(target).find(candidate => candidate.order.includes(node))
  if (row == null) return text
  return writeRows(text, target, [{ row, order: row.order.filter(name => name !== node) }])
}

export const VIEW_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function viewGraph(document, view) {
  const found = document.graphs.find(candidate => candidate.id?.value === view)
  if (found == null) throw new DotEditError(`There is no view "${view}"`)
  return found
}

export function viewIdFor(text, title) {
  const base = String(title ?? '').split('\\n')[0].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'view'
  const taken = new Set(parse(text).graphs.map(graph => graph.id?.value))
  if (!taken.has(base) && base !== 'whole-map') return base
  for (let k = 2; ; k += 1) if (!taken.has(`${base}-${k}`)) return `${base}-${k}`
}

function viewBlock(view, attrs, lines = []) {
  const head = Object.entries(attrs)
    .filter(([, value]) => value != null)
    .map(([key, value]) => `  ${formatId(key)}=${formatValue(value)}`)
  return [`digraph ${formatId(view)} {`, ...head, ...lines.map(line => `  ${line}`), '}'].join('\n')
}

function appendGraph(text, block) {
  return `${text.replace(/\s*$/, '')}\n\n${block}\n`
}

export function addView(text, { view, title, parent }) {
  if (!VIEW_ID.test(view) || view === 'whole-map') throw new DotEditError(`"${view}" can't be a view id; use lowercase letters, digits and hyphens`)
  if (parse(text).graphs.some(graph => graph.id?.value === view)) throw new DotEditError(`There is already a view "${view}"`)
  if (parent != null) viewGraph(parse(text), parent)
  return appendGraph(text, viewBlock(view, { title, parent }))
}

function forEachLink(text, view, change) {
  let current = text
  parse(text).graphs.forEach((graph, index) => {
    if (graph.id == null) return
    const model = describe(current, { graph: index })
    for (const node of model.nodes.values()) {
      if (node.attrs.URL === `#${view}`) current = change(current, { graph: index, node: node.id })
    }
    for (const subgraph of model.subgraphs.values()) {
      if (subgraph.attrs.URL === `#${view}`) current = change(current, { graph: index, subgraph: subgraph.id })
    }
  })
  return current
}

function setLinkAttr(text, where, value) {
  if (where.node != null) return setNodeAttr(text, { graph: where.graph, node: where.node, key: 'URL', value })
  return setGraphAttr(text, { graph: where.graph, subgraph: where.subgraph, key: 'URL', value })
}

export function setLink(text, { graph, node, subgraph, view }) {
  if (view != null) viewGraph(parse(text), view)
  return setLinkAttr(text, { graph, node, subgraph }, view == null ? null : `#${view}`)
}

export function removeView(text, { view }) {
  const document = parse(text)
  const graph = viewGraph(document, view)
  const parent = describe(text, { graph: view }).attrs.parent ?? null
  let current = forEachLink(text, view, (value, where) => setLinkAttr(value, where, null))
  parse(current).graphs.forEach((candidate, index) => {
    if (describe(current, { graph: index }).attrs.parent === view) current = setGraphAttr(current, { graph: index, key: 'parent', value: parent })
  })
  const target = viewGraph(parse(current), view)
  let start = target.start
  while (start > 0 && /\s/.test(current[start - 1])) start -= 1
  const result = current.slice(0, start) + current.slice(target.end)
  return graph === parse(text).graphs[0] ? result.replace(/^\s+/, '') : result
}

export function renameView(text, { view, to }) {
  if (view === to) return text
  if (!VIEW_ID.test(to) || to === 'whole-map') throw new DotEditError(`"${to}" can't be a view id; use lowercase letters, digits and hyphens`)
  const document = parse(text)
  if (document.graphs.some(graph => graph.id?.value === to)) throw new DotEditError(`There is already a view "${to}"`)
  const target = viewGraph(document, view)
  let current = splice(text, target.id.start, target.id.end, formatId(to))
  current = forEachLink(current, view, (value, where) => setLinkAttr(value, where, `#${to}`))
  parse(current).graphs.forEach((graph, index) => {
    if (describe(current, { graph: index }).attrs.parent === view) current = setGraphAttr(current, { graph: index, key: 'parent', value: to })
  })
  return current
}

function isolateAll(text, graph, touches) {
  let current = text
  for (let guard = 0; guard < 10000; guard += 1) {
    const target = pickGraph(parse(current), graph)
    const edge = edgeList(target).find(candidate => touches(candidate) && (candidate.statement.operands.length > 2 || !candidate.simple))
    if (edge == null) return current
    if (!edge.simple) throw new DotEditError(`"${edge.from} → ${edge.to}" is written as a group; edit the DOT to split it first`)
    current = isolateEdge(current, target, edge)
  }
  throw new DotEditError('Could not split the connections into single arrows')
}

export function clusterToView(text, { graph, cluster, view, ghosts = true }) {
  const first = pickGraph(parse(text), graph)
  if (first.id == null) throw new DotEditError('Give the graph a name before turning a box into a view')
  const home = first.id.value
  const box = describe(text, { graph }).subgraphs.get(cluster)
  if (box == null || !box.isCluster) throw new DotEditError(`There is no box named "${cluster}"`)
  const title = typeof box.attrs.label === 'string' && box.attrs.label !== '' ? box.attrs.label.split('\\n')[0] : cluster.replace(/^cluster_?/, '') || cluster
  const target0 = pickGraph(parse(text), graph)
  const anchor = anchorId(cluster)
  const inside = new Set()
  for (const item of walk(findCluster(target0, cluster).body)) {
    if (item.type === 'node' && item.id.value !== anchor) inside.add(item.id.value)
    if (item.type === 'edge') for (const operand of item.operands) if (operand.kind === 'node' && operand.id.value !== anchor) inside.add(operand.id.value)
  }
  const touches = edge => inside.has(edge.from) || inside.has(edge.to) || edge.from === anchor || edge.to === anchor
  const current = isolateAll(text, graph, touches)
  const target = pickGraph(parse(current), graph)
  const item = findCluster(target, cluster)
  const newView = view ?? viewIdFor(current, title)
  if (!VIEW_ID.test(newView)) throw new DotEditError(`"${newView}" can't be a view id`)
  const names = nodeNames(target)
  let node = newView.replace(/-/g, '_')
  for (let k = 2; names.has(node); k += 1) node = `${newView.replace(/-/g, '_')}_${k}`
  const op = target.kind === 'digraph' ? '->' : '--'
  const lines = []
  const ops = []
  const insideBox = statement => statement.start >= item.start && statement.end <= item.end
  for (const statement of item.body) {
    if (statement.type === 'assign' || (statement.type === 'attr' && statement.target === 'graph') || statement.type === 'edge') continue
    if (statement.type === 'node' && statement.id.value === anchor) continue
    if (statement.type === 'subgraph') {
      for (const nested of walk(statement.body)) {
        if (nested.type === 'edge' && nested.operands.some(operand => operand.kind === 'node' && !inside.has(operand.id.value))) {
          throw new DotEditError('A box inside this box has a connection to the outside; edit the DOT to move it first')
        }
      }
    }
    lines.push(reindent(current.slice(statement.start, statement.end), lineIndent(current, statement.start), ''))
  }
  for (const statement of walk(target.body)) {
    if (statement.type === 'node' && inside.has(statement.id.value) && !insideBox(statement)) {
      lines.push(current.slice(statement.start, statement.end))
      ops.push(statementRemoval(current, statement))
    }
  }
  const crossing = new Map()
  const ghostLines = new Map()
  const handled = new Set()
  for (const edge of edgeList(target)) {
    if (!touches(edge) || handled.has(edge.statement)) continue
    handled.add(edge.statement)
    const fromInside = inside.has(edge.from)
    const toInside = inside.has(edge.to)
    const attrs = readAttrs(edge.statement.lists)
    delete attrs.lhead
    delete attrs.ltail
    if (!insideBox(edge.statement)) ops.push(statementRemoval(current, edge.statement))
    if (fromInside && toInside) {
      lines.push(`${formatId(edge.from)} ${op} ${formatId(edge.to)}${formatAttrs(attrs)}`)
      continue
    }
    const tail = fromInside || edge.from === anchor ? node : edge.from
    const head = toInside || edge.to === anchor ? node : edge.to
    if (tail === head) continue
    const line = `${formatId(tail)} ${op} ${formatId(head)}${formatAttrs(attrs)}`
    crossing.set(line, line)
    const outside = fromInside ? edge.to : edge.from
    const outsideNode = describe(current, { graph }).nodes.get(outside)
    const realOutside = outside !== anchor && !String(outsideNode?.attrs.style ?? '').includes('invis')
    if (ghosts && toInside && !fromInside && realOutside) {
      const outsideClasses = String(outsideNode?.attrs.class ?? '').split(/\s+/)
      const outsideHome = outsideClasses.includes('ghost') && typeof outsideNode.attrs.URL === 'string' ? outsideNode.attrs.URL : `#${home}`
      ghostLines.set(outside, `${formatId(outside)}${formatAttrs({ label: outsideNode?.attrs.label, class: 'ghost', URL: outsideHome })}`)
      lines.push(`${formatId(edge.from)} ${op} ${formatId(edge.to)}${formatAttrs(attrs)}`)
    }
  }
  const nodeAttrs = { label: title, URL: `#${newView}` }
  if (box.attrs.class != null) nodeAttrs.class = box.attrs.class
  ops.push({ start: item.start, end: item.stop, insert: `${formatId(node)}${formatAttrs(nodeAttrs)}` })
  if (crossing.size > 0) ops.push(endInsertion(current, target, [...crossing.values()]))
  let result = applyOps(current, ops)
  for (const name of inside) result = leaveRow(result, { graph, node: name })
  const left = [...nodeNames(pickGraph(parse(result), graph))].filter(name => inside.has(name))
  if (left.length > 0) throw new DotEditError(`"${left[0]}" is also used elsewhere in this view; edit the DOT to move it first`)
  result = appendGraph(result, viewBlock(newView, { title, parent: home }, [...ghostLines.values(), ...lines]))
  for (const other of parse(result).graphs) {
    const otherId = other.id?.value
    if (otherId == null || otherId === home || otherId === newView) continue
    for (const [name, found] of describe(result, { graph: otherId }).nodes) {
      const classes = String(found.attrs.class ?? '').split(/\s+/)
      if (inside.has(name) && classes.includes('ghost') && found.attrs.URL === `#${home}`) {
        result = setNodeAttr(result, { graph: otherId, node: name, key: 'URL', value: `#${newView}` })
      }
    }
  }
  return result
}

export function addGhost(text, { graph, node, from }) {
  const home = describe(text, { graph: from }).nodes.get(node)
  if (home == null) throw new DotEditError(`There is no node "${node}" in "${from}"`)
  if (String(home.attrs.class ?? '').split(/\s+/).includes('ghost')) throw new DotEditError(`"${node}" is itself a ghost in "${from}"; add it from its home view`)
  const target = pickGraph(parse(text), graph)
  if (target.id?.value === from) throw new DotEditError(`"${node}" already lives in this view`)
  if (nodeNames(target).has(node)) throw new DotEditError(`"${node}" is already in this view`)
  return insertAtEnd(text, target, `${formatId(node)}${formatAttrs({ label: home.attrs.label, class: 'ghost', URL: `#${from}` })}`)
}

const EDITS = { setNodeAttr, setEdgeAttr, setGraphAttr, addNode, removeNode, addEdge, removeEdge, renameNode, addCluster, moveNode, moveCluster, placeInRow, leaveRow, addView, removeView, renameView, setLink, clusterToView, addGhost }

export function applyEdit(text, edit) {
  if (edit.type === 'batch') return edit.edits.reduce(applyEdit, text)
  const apply = EDITS[edit.type]
  if (apply == null) throw new DotEditError(`Unknown edit "${edit.type}"`)
  return apply(text, edit)
}

export function describe(text, { graph } = {}) {
  const target = pickGraph(parse(text), graph)
  const nodes = new Map()
  for (const name of nodeNames(target)) nodes.set(name, { id: name, attrs: {} })
  const subgraphs = new Map()
  const attrs = {}
  const collectGraphAttrs = (body, into) => {
    for (const item of body) {
      if (item.type === 'assign') into[item.key.value] = attrValue(item.value)
      if (item.type === 'attr' && item.target === 'graph') readAttrs(item.lists, into)
    }
  }
  collectGraphAttrs(target.body, attrs)
  const defaults = { node: {}, edge: {} }
  for (const item of target.body) if (item.type === 'attr' && item.target !== 'graph') readAttrs(item.lists, defaults[item.target])
  const chains = clusterChains(target)
  for (const item of walk(target.body)) {
    if (item.type === 'node') readAttrs(item.lists, nodes.get(item.id.value).attrs)
    if (item.type === 'subgraph' && item.id != null) {
      const subgraphAttrs = {}
      collectGraphAttrs(item.body, subgraphAttrs)
      subgraphs.set(item.id.value, { id: item.id.value, attrs: subgraphAttrs, isCluster: isCluster(item), parent: isCluster(item) ? chains.get(item)?.at(-2)?.id.value ?? null : null })
    }
  }
  const mentions = nodeMentions(target)
  for (const node of nodes.values()) node.cluster = nodePath(mentions, node.id).at(-1)?.id.value ?? null
  const edges = edgeList(target).map(({ from, to, index, statement, simple }) => ({
    from,
    to,
    index,
    attrs: readAttrs(statement.lists),
    editable: simple && statement.operands.every(operand => operand.kind === 'node'),
  }))
  const rows = new Map(rowsOf(target).map(row => [row.id, row.order]))
  for (const [id, order] of rows) for (const name of order) if (nodes.has(name)) nodes.get(name).row = id
  return { id: target.id?.value ?? null, kind: target.kind, strict: target.strict, attrs, defaults, nodes, edges, subgraphs, rows }
}

export function nodeSlug(label) {
  const first = String(label ?? '').split(/\\n|\n/)[0]
  let slug = first.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  if (slug === '') slug = 'item'
  if (/^\d/.test(slug)) slug = `n_${slug}`
  if (KEYWORDS.has(slug)) slug = `${slug}_item`
  return slug
}

export function newNodeId(text, { label = 'New node', taken = [] } = {}) {
  const names = new Set([...parse(text).graphs.flatMap(graph => [...nodeNames(graph)]), ...taken])
  const base = nodeSlug(label)
  if (!names.has(base)) return base
  for (let k = 2; ; k += 1) if (!names.has(`${base}_${k}`)) return `${base}_${k}`
}

export function isGeneratedId(id, label) {
  const base = nodeSlug(label ?? id)
  return /^node\d+$/.test(id) || id === base || new RegExp(`^${base}_\\d+$`).test(id) || id === nodeSlug(id) && /^new_node(_\d+)?$/.test(id)
}

export const LINE_STYLES = ['solid', 'dashed', 'dotted', 'bold']

export function styleTokens(style) {
  return String(style ?? '')
    .split(',')
    .map(token => token.trim())
    .filter(token => token !== '')
}

export function lineStyleOf(style) {
  return styleTokens(style).findLast(token => LINE_STYLES.includes(token)) ?? 'solid'
}

export function restyle(style, { line, filled } = {}) {
  let tokens = styleTokens(style)
  if (line != null) {
    tokens = tokens.filter(token => !LINE_STYLES.includes(token))
    if (line !== 'solid') tokens.push(line)
  }
  if (filled === true && !tokens.includes('filled')) tokens.push('filled')
  if (filled === false) tokens = tokens.filter(token => token !== 'filled')
  return tokens.join(',')
}

export function decodeText(value) {
  return String(value ?? '').replace(/\\(.)/g, (whole, character) => (character === 'n' || character === 'l' || character === 'r' ? '\n' : character === '\\' ? '\\' : whole))
}

export function encodeText(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n')
}
