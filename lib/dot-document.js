import { applyEdit, parse } from './dot-text.js'

export class DotValidationError extends Error {
  constructor(message) {
    super(message)
    this.name = 'DotValidationError'
  }
}

export function vizValidator(viz) {
  return text => {
    for (const graph of parse(text).graphs) {
      const result = viz.render(text.slice(graph.start, graph.end), { format: 'svg' })
      const errors = (result.errors ?? []).filter(error => error.level !== 'warning')
      if (result.status !== 'success' || errors.length > 0) {
        const name = graph.id == null ? 'The graph' : `Graph "${graph.id.value}"`
        const reason = errors.map(error => error.message.trim()).join('; ') || 'Graphviz could not draw it'
        throw new DotValidationError(`${name}: ${reason}`)
      }
    }
  }
}

function check(text, validate) {
  try {
    parse(text)
    validate(text)
    return null
  } catch (error) {
    return error
  }
}

export function createDotDocument(initialText, { validate = () => {}, onChange = () => {}, historyLimit = 200 } = {}) {
  const problem = check(initialText, validate)
  if (problem != null) throw problem
  let text = initialText
  const past = []
  const future = []

  function move(next, cause) {
    text = next
    onChange(text, { cause })
  }

  function commit(next, cause) {
    if (next === text) return { ok: true, changed: false }
    const error = check(next, validate)
    if (error != null) return { ok: false, error }
    past.push(text)
    if (past.length > historyLimit) past.shift()
    future.length = 0
    move(next, cause)
    return { ok: true, changed: true }
  }

  return {
    get text() {
      return text
    },
    get canUndo() {
      return past.length > 0
    },
    get canRedo() {
      return future.length > 0
    },
    apply(edit) {
      let next
      try {
        next = applyEdit(text, edit)
      } catch (error) {
        return { ok: false, error }
      }
      return commit(next, 'edit')
    },
    replace(next) {
      return commit(next, 'replace')
    },
    load(next) {
      const error = check(next, validate)
      if (error != null) return { ok: false, error }
      past.length = 0
      future.length = 0
      move(next, 'load')
      return { ok: true, changed: true }
    },
    undo() {
      if (past.length === 0) return false
      future.push(text)
      move(past.pop(), 'undo')
      return true
    },
    redo() {
      if (future.length === 0) return false
      past.push(text)
      move(future.pop(), 'redo')
      return true
    },
  }
}
