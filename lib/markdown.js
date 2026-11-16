const SAFE_URL = /^(https?:|mailto:|#)/i

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function inline(text) {
  const codes = []
  let html = escapeHtml(text).replace(/`([^`]+)`/g, (_, code) => {
    codes.push(code)
    return `\u0000${codes.length - 1}\u0000`
  })
  html = html
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (whole, label, url) => {
      const href = url.replace(/&amp;/g, '&')
      if (!SAFE_URL.test(href)) return whole
      const external = !href.startsWith('#')
      return `<a href="${escapeHtml(href)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ''}>${label}</a>`
    })
    .replace(/\*\*(?=\S)([^*]*\S)\*\*/g, '<strong>$1</strong>')
    .replace(/__(?=\S)([^_]*\S)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*(?=\S)([^*]*\S)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_(?=\S)([^_]*\S)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~(?=\S)([^~]*\S)~~/g, '<del>$1</del>')
  return html.replace(/\u0000(\d+)\u0000/g, (_, index) => `<code>${codes[Number(index)]}</code>`)
}

export function renderMarkdown(source) {
  const lines = String(source ?? '').replace(/\r\n?/g, '\n').split('\n')
  const out = []
  let index = 0
  const isBlank = line => /^\s*$/.test(line)
  const listItem = /^\s*([-*+]|\d+[.)])\s+(.*)$/
  while (index < lines.length) {
    const line = lines[index]
    if (isBlank(line)) {
      index += 1
      continue
    }
    const fence = /^\s*```/.exec(line)
    if (fence) {
      const body = []
      index += 1
      while (index < lines.length && !/^\s*```/.test(lines[index])) body.push(lines[index++])
      index += 1
      out.push(`<pre><code>${escapeHtml(body.join('\n'))}</code></pre>`)
      continue
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      const level = Math.min(heading[1].length + 2, 6)
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`)
      index += 1
      continue
    }
    if (/^\s*>/.test(line)) {
      const body = []
      while (index < lines.length && /^\s*>/.test(lines[index])) body.push(lines[index++].replace(/^\s*>\s?/, ''))
      out.push(`<blockquote>${renderMarkdown(body.join('\n'))}</blockquote>`)
      continue
    }
    const first = listItem.exec(line)
    if (first) {
      const ordered = /\d/.test(first[1])
      const items = []
      while (index < lines.length) {
        const item = listItem.exec(lines[index])
        if (item == null || /\d/.test(item[1]) !== ordered) break
        items.push(item[2])
        index += 1
        while (index < lines.length && !isBlank(lines[index]) && !listItem.test(lines[index]) && /^\s+/.test(lines[index])) {
          items[items.length - 1] += ` ${lines[index++].trim()}`
        }
      }
      const tag = ordered ? 'ol' : 'ul'
      out.push(`<${tag}>${items.map(item => `<li>${inline(item)}</li>`).join('')}</${tag}>`)
      continue
    }
    const body = []
    while (index < lines.length && !isBlank(lines[index]) && !/^\s*(```|#{1,6}\s|>)/.test(lines[index]) && !listItem.test(lines[index])) body.push(lines[index++])
    out.push(`<p>${body.map(inline).join('<br>')}</p>`)
  }
  return out.join('')
}
