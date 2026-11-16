const { chromium } = require('playwright-core')
const { rect, startBox } = require('./helpers.cjs')
const check = (name, ok, detail = '') => console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : '\n' + detail}`)
const source = page => page.$eval('#source', el => el.value)
async function marquee(page, ids) {
  const boxes = await Promise.all(ids.map(id => rect(page, '#canvas g.node', id)))
  const x1 = Math.min(...boxes.map(b => b.x)) - 12, y1 = Math.min(...boxes.map(b => b.y)) - 12
  const x2 = Math.max(...boxes.map(b => b.x + b.w)) + 12, y2 = Math.max(...boxes.map(b => b.y + b.h)) + 12
  await startBox(page)
  await page.mouse.move(x1, y1); await page.mouse.down(); await page.mouse.move(x2, y2, { steps: 12 }); await page.mouse.up()
  await page.waitForSelector('.dc-editor'); await page.keyboard.press('Enter')
}
;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1300, height: 760 } })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto('http://localhost:8091/?doc=test&fresh')
  await page.waitForSelector('#canvas svg g.node')
  for (const id of ['browse', 'cart', 'pay']) { const r = await rect(page, '#canvas g.node', id); await page.mouse.click(r.cx, r.cy); await page.click('button[aria-label="Color: Green"]') }
  await marquee(page, ['browse', 'done'])
  let s = await source(page)
  check('a box around nodes that all share a color takes that color', /subgraph cluster_1 \{[^}]*class=green/.test(s), s)
  await page.click('#undo')
  const r = await rect(page, '#canvas g.node', 'browse'); await page.mouse.click(r.cx, r.cy); await page.click('button[aria-label="Color: Blue"]')
  await marquee(page, ['browse', 'done'])
  s = await source(page)
  check('mixed colors leave the box plain', /subgraph cluster_1 \{/.test(s) && !/subgraph cluster_1 \{\n\s*label="New box"\n\s*class=/.test(s), s)
  check('no page errors', errors.length === 0, errors.join('\n'))
  await browser.close()
})()
