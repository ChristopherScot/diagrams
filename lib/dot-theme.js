import { DEFAULT_PALETTE, paletteDark } from './palette.js'

const STYLE_ID = 'dot-theme-style'
const STYLE = `
.dot-themed .dt-backdrop { fill: transparent; stroke: none; }
`

function toLinear(channel) {
  const c = channel / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function fromLinear(value) {
  const c = value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055
  return Math.round(Math.min(1, Math.max(0, c)) * 255)
}

function toOklab([r, g, b]) {
  const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)]
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  }
}

function oklabToLinear({ L, a, b }) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

function toHex(lab) {
  let { a, b } = lab
  for (let step = 0; step < 60; step += 1) {
    const linear = oklabToLinear({ L: lab.L, a, b })
    if (linear.every(channel => channel >= -0.0005 && channel <= 1.0005)) break
    a *= 0.95
    b *= 0.95
  }
  return `#${oklabToLinear({ L: lab.L, a, b })
    .map(fromLinear)
    .map(channel => channel.toString(16).padStart(2, '0'))
    .join('')}`
}

function parseHex(value) {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim())
  if (match == null) return null
  const digits = match[1].length === 3 ? [...match[1]].map(digit => digit + digit).join('') : match[1]
  return [0, 2, 4].map(at => parseInt(digits.slice(at, at + 2), 16))
}

let probe = null
function parseColor(value) {
  const hex = parseHex(value)
  if (hex != null) return hex
  if (typeof document === 'undefined') return null
  probe ??= document.createElement('canvas').getContext('2d')
  probe.fillStyle = '#010203'
  probe.fillStyle = value
  const normalized = probe.fillStyle
  if (normalized === '#010203' && value.trim().toLowerCase() !== '#010203') return null
  return parseHex(normalized)
}

function darkVersion(lab, role) {
  const chroma = Math.hypot(lab.a, lab.b)
  if (role === 'ink') return { ...lab, L: Math.max(lab.L, 0.93 - 0.45 * lab.L) }
  const L = 0.31 + 0.35 * (1 - lab.L)
  const nextChroma = Math.min(chroma * 2.2, 0.09)
  const scale = chroma === 0 ? 0 : nextChroma / chroma
  return { L, a: lab.a * scale, b: lab.b * scale }
}

export function themeColor(value, role, palette = DEFAULT_PALETTE) {
  const rgb = parseColor(value)
  if (rgb == null) return null
  const light = `#${rgb.map(channel => channel.toString(16).padStart(2, '0')).join('')}`
  return { light, dark: paletteDark(palette, light, role) ?? toHex(darkVersion(toOklab(rgb), role)) }
}

export function themeCss(value, role, palette = DEFAULT_PALETTE) {
  const color = themeColor(value, role, palette)
  if (color == null) return value
  let dark = color.dark
  if (role === 'ink' && color.light === '#000000') dark = `var(--dt-ink, ${dark})`
  if (role === 'surface' && color.light === '#ffffff') dark = `var(--dt-surface, ${dark})`
  return `light-dark(${color.light}, ${dark})`
}

function injectStyle(document) {
  if (document.getElementById(STYLE_ID) != null) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = STYLE
  document.head.append(style)
}

function roleOf(element, property) {
  if (property === 'stroke') return 'ink'
  if (element.localName === 'text' || element.closest('g.edge') != null) return 'ink'
  return 'surface'
}

function isBackdrop(element) {
  const graph = element.parentNode
  return (
    element.localName === 'polygon' &&
    graph?.classList?.contains('graph') &&
    graph.querySelector(':scope > polygon') === element &&
    (element.getAttribute('fill') ?? '').toLowerCase() === 'white'
  )
}

export function themeSvg(svg, { palette = DEFAULT_PALETTE } = {}) {
  if (typeof svg === 'string') svg = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement
  injectStyle(document)
  const rules = new Map()
  for (const element of svg.querySelectorAll('[fill], [stroke], text')) {
    if (isBackdrop(element)) {
      element.classList.add('dt-backdrop')
      continue
    }
    for (const property of ['fill', 'stroke']) {
      const value = element.getAttribute(property) ?? (property === 'fill' && element.localName === 'text' ? 'black' : null)
      if (value == null || /^(none|transparent|url\()/i.test(value.trim())) continue
      const role = roleOf(element, property)
      const color = themeColor(value, role, palette)
      if (color == null) continue
      const name = `dt-${property[0]}${role[0]}-${color.light.slice(1)}`
      if (!rules.has(name)) rules.set(name, `.${name} { ${property}: ${themeCss(value, role, palette)}; }`)
      element.classList.add(name)
    }
  }
  const style = svg.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'style')
  style.textContent = [...rules.values()].join('\n')
  svg.insertBefore(style, svg.firstChild)
  svg.classList.add('dot-themed')
  return svg
}
