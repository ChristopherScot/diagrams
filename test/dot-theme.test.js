import { test } from 'node:test'
import assert from 'node:assert/strict'
import { themeColor, themeCss } from '../lib/dot-theme.js'

const channels = hex => [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16))
const brightness = hex => channels(hex).reduce((sum, channel) => sum + channel, 0) / 765

test('black lines and text turn light in dark mode', () => {
  const { light, dark } = themeColor('#000', 'ink')
  assert.equal(light, '#000000')
  assert.ok(brightness(dark) > 0.85, dark)
})

test('a light fill turns into a dark fill of the same hue', () => {
  const { dark } = themeColor('#dbeafe', 'surface')
  const [r, g, b] = channels(dark)
  assert.ok(brightness(dark) < 0.3, dark)
  assert.ok(b > r && b > g, `${dark} should stay blue`)
})

test('a saturated line color stays recognisable and gets lighter', () => {
  const { dark } = themeColor('#dc2626', 'ink')
  const [r, g, b] = channels(dark)
  assert.ok(r > g && r > b, `${dark} should stay red`)
  assert.ok(brightness(dark) > brightness('#dc2626'), dark)
})

test('light text such as white stays light', () => {
  assert.equal(themeColor('#ffffff', 'ink').dark, '#ffffff')
})

test('default black and white defer to the page tokens', () => {
  assert.match(themeCss('#000000', 'ink'), /^light-dark\(#000000, var\(--dt-ink, #[0-9a-f]{6}\)\)$/)
  assert.match(themeCss('#ffffff', 'surface'), /^light-dark\(#ffffff, var\(--dt-surface, #[0-9a-f]{6}\)\)$/)
  assert.match(themeCss('#dc2626', 'ink'), /^light-dark\(#dc2626, #[0-9a-f]{6}\)$/)
})

test('palette colors use their tuned dark versions', () => {
  assert.equal(themeColor('#e9edfc', 'surface').dark, '#252c4b')
  assert.equal(themeColor('#5a6fd8', 'ink').dark, '#8c9cf0')
  assert.equal(themeColor('#5A6FD8', 'ink').dark, '#8c9cf0')
})

test('a custom palette replaces the default one', () => {
  const palette = [{ name: 'Brand', fill: { light: '#fff0f0', dark: '#301010' }, line: { light: '#aa0000', dark: '#ff7777' } }]
  assert.equal(themeColor('#aa0000', 'ink', palette).dark, '#ff7777')
  assert.notEqual(themeColor('#5a6fd8', 'ink', palette).dark, '#8c9cf0')
})

test('house neutrals use the skill tuned dark tones', () => {
  assert.equal(themeColor('#6a7387', 'ink').dark, '#8f98ab')
  assert.equal(themeColor('#d6dae3', 'ink').dark, '#333a48')
  assert.equal(themeColor('#ffffff', 'surface').dark, '#1a1e27')
  assert.equal(themeColor('#ffffff', 'ink').dark, '#ffffff')
})
