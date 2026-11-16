const { chromium } = require('playwright-core')
const out = process.env.E2E_OUT
const center = (page, title) => page.evaluate(title => {
  const g = [...document.querySelectorAll('#canvas g.node')].find(g => g.querySelector('title').textContent === title)
  const r = g.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
}, title)
const source = page => page.$eval('#source', el => el.value)
const check = (name, ok, detail = '') => console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : '\n' + detail}`)
;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1300, height: 760 } })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto('http://localhost:8091/?doc=test&fresh')
  await page.waitForSelector('#canvas svg g.node')
  let p = await center(page, 'done')
  await page.mouse.click(p.x, p.y)
  check('shape shows rectangle pressed for the default', await page.$eval('button[aria-label="Rectangle"]', b => b.getAttribute('aria-pressed')) === 'true')
  await page.click('button[aria-label="Diamond"]')
  await page.click('button[aria-label="Color: Violet"]')
  let s = await source(page)
  check('shape and color', s.includes('done [label="Order placed", class=violet, shape=diamond]'), s)
  p = await center(page, 'cart')
  await page.mouse.click(p.x, p.y)
  await page.click('button[aria-label="Cylinder"]')
  s = await source(page)
  check('cylinder', s.includes('cart [label="Cart", shape=cylinder]'), s)
  check('arrow selection has no shape row', await (async () => {
    const e = await page.evaluate(() => { const g = [...document.querySelectorAll('#canvas g.edge')][0]; const r = g.querySelector('text').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
    await page.mouse.click(e.x, e.y)
    return (await page.$('button[aria-label="Diamond"]')) == null && (await page.$('button[aria-label="Color: Rose"]')) != null
  })())
  await page.screenshot({ path: `${out}/playground-shapes.png` })
  check('no page errors', errors.length === 0, errors.join('\n'))
  await browser.close()
})()
