import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderMarkdown } from '../lib/markdown.js'
import { decodeText, encodeText, applyEdit, describe } from '../lib/dot-text.js'

test('markdown renders the common syntax and nothing unsafe', () => {
  assert.equal(renderMarkdown('Some **bold**, *em* and `x < y`.'), '<p>Some <strong>bold</strong>, <em>em</em> and <code>x &lt; y</code>.</p>')
  assert.equal(renderMarkdown('# Head\n\n- one\n- two\n\n1. a\n2. b'), '<h3>Head</h3><ul><li>one</li><li>two</li></ul><ol><li>a</li><li>b</li></ol>')
  assert.equal(renderMarkdown('See [docs](https://x.dev) and [view](#store).'), '<p>See <a href="https://x.dev" target="_blank" rel="noopener noreferrer">docs</a> and <a href="#store">view</a>.</p>')
  assert.equal(renderMarkdown('<script>alert(1)</script> [x](javascript:alert(1))'), '<p>&lt;script&gt;alert(1)&lt;/script&gt; [x](javascript:alert(1))</p>')
  assert.equal(renderMarkdown('```\na <b>\n```'), '<pre><code>a &lt;b&gt;</code></pre>')
  assert.equal(renderMarkdown('snake_case_name stays'), '<p>snake_case_name stays</p>')
})

test('multi-line text round-trips through a DOT attribute the way the skill reads it', () => {
  const text = 'line one\n\n- a "quoted" item\nback\\slash'
  const dot = applyEdit('digraph g {\n  a\n}\n', { type: 'setGraphAttr', key: 'notes', value: encodeText(text) })
  assert.ok(!dot.slice(dot.indexOf('notes')).split('\n')[0].endsWith('one'))
  assert.equal(decodeText(describe(dot).attrs.notes), text)
})
