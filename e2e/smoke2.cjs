const { chromium } = require('playwright-core')
const out = process.env.E2E_OUT
const center = (page, selector, title) => page.evaluate(([selector, title]) => {
  const g = [...document.querySelectorAll(selector)].find(g => g.querySelector('title').textContent === title)
  const t = selector.includes('node') ? g : (g.querySelector('text') || g)
  const r = t.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
}, [selector, title])
const source = page => page.$eval('#source', el => el.value)
const check = (name, ok, detail = '') => console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : '\n' + detail}`)
;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1300, height: 760 } })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto('http://localhost:8091/?doc=test&fresh')
  await page.waitForSelector('#canvas svg g.node')
  check('bar hidden with nothing selected', await page.$eval('#style-bar', el => el.hidden))

  let p = await center(page, '#canvas g.edge', 'cart->pay')
  await page.mouse.click(p.x, p.y)
  await page.click('button[aria-label="Dashed"]')
  await page.click('button[aria-label="Color: Rose"]')
  await page.click('button[aria-label="Both ways"]')
  let s = await source(page)
  check('arrow dashed, rose, both ways', s.includes('cart -> pay [label="checkout", style=dashed, class=rose, dir=both]'), s)
  check('pressed state follows the arrow', await page.$eval('button[aria-label="Dashed"]', b => b.getAttribute('aria-pressed')) === 'true')

  p = await center(page, '#canvas g.node', 'pay')
  await page.mouse.click(p.x, p.y)
  await page.click('button[aria-label="Color: Amber"]')
  await page.click('button[aria-label="Dotted"]')
  s = await source(page)
  check('color and dotted border keep the defaults', s.includes('pay [label="Payment", class=amber, style="rounded,filled,dotted"]'), s)

  p = await center(page, '#canvas g.cluster', 'cluster_store')
  await page.mouse.click(p.x, p.y)
  await page.click('button[aria-label="Color: Slate"]')
  await page.click('button[aria-label="Solid"]')
  s = await source(page)
  check('cluster color, and solid removes the dashed style', s.includes('class=slate') && !s.includes('style=dashed\n    cart'), s)

  await page.screenshot({ path: `${out}/playground-styles.png` })
  check('no page errors', errors.length === 0, errors.join('\n'))
  await browser.close()
})()
