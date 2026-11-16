const { chromium } = require('playwright-core')
const out = process.env.E2E_OUT
const check = (name, ok, detail = '') => console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : '\n' + detail}`)
const colors = page => page.evaluate(() => {
  const node = id => [...document.querySelectorAll('#canvas g.node')].find(g => g.querySelector('title').textContent === id)
  const lum = c => { const m = c.match(/\d+(\.\d+)?/g).map(Number); return (m[0] + m[1] + m[2]) / 765 }
  const cs = el => getComputedStyle(el)
  const done = node('done')
  const edge = document.querySelector('#canvas g.edge')
  return {
    doneFill: cs(done.querySelector('path, polygon')).fill,
    doneText: cs(done.querySelector('text')).fill,
    edgeStroke: cs(edge.querySelector('path:not(.dc-hit)')).stroke,
    edgeText: cs(edge.querySelector('text')).fill,
    backdrop: (() => { const first = document.querySelector('#canvas g.graph > polygon'); return first == null || first.closest('g.cluster, g.node, g.edge') != null ? 'transparent' : cs(first).fill })(),
    canvasBg: cs(document.querySelector('#canvas')).backgroundColor,
    lum: { doneFill: lum(cs(done.querySelector('path, polygon')).fill), doneText: lum(cs(done.querySelector('text')).fill), edge: lum(cs(edge.querySelector('path:not(.dc-hit)')).stroke) },
  }
})
;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1300, height: 760 }, colorScheme: 'dark' })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => m.type() === 'error' && errors.push(m.text()))
  await page.goto('http://localhost:8091/?doc=test&fresh')
  await page.waitForSelector('#canvas svg g.node')
  let c = await colors(page)
  console.log(JSON.stringify(c))
  check('dark: box fill is dark', c.lum.doneFill < 0.3)
  check('dark: box text is light', c.lum.doneText > 0.8)
  check('dark: arrows are light', c.lum.edge > 0.5)
  check('dark: backdrop is transparent', c.backdrop === 'rgba(0, 0, 0, 0)' || c.backdrop === 'transparent', c.backdrop)
  const p = await page.evaluate(() => { const g = [...document.querySelectorAll('#canvas g.node')].find(g => g.querySelector('title').textContent === 'pay'); const r = g.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
  await page.mouse.click(p.x, p.y)
  await page.click('button[aria-label="Color: Amber"]')
  await page.screenshot({ path: `${out}/playground-dark.png` })
  await page.emulateMedia({ colorScheme: 'light' })
  c = await colors(page)
  check('a light system: box fill is light', c.lum.doneFill > 0.8)
  check('a light system: box text is dark', c.lum.doneText < 0.2)
  await page.screenshot({ path: `${out}/playground-light.png` })
  check('no page errors', errors.length === 0, errors.join('\n'))
  await browser.close()
})()
