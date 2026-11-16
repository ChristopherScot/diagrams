const { chromium } = require('playwright-core')
const { rect } = require('./helpers.cjs')
const out = process.env.E2E_OUT
const check = (name, ok, detail = '') => console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : '\n' + detail}`)
const crumbs = page => page.$$eval('#crumbs button:not(.delete-view)', bs => bs.map(b => b.textContent).join(' › '))
const look = (page, id) => page.evaluate(id => {
  const g = [...document.querySelectorAll('#canvas g.node')].find(n => n.querySelector('title').textContent === id)
  const shape = g.querySelector(':scope > path:not(.dc-link-hit), :scope > polygon')
  const badge = g.querySelector('.dc-link-badge circle')
  return {
    badge: badge != null,
    badgeStroke: badge ? getComputedStyle(badge).stroke : null,
    outline: getComputedStyle(shape).stroke,
    width: getComputedStyle(shape).strokeWidth,
  }
}, id)

;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1300, height: 760 }, colorScheme: 'dark', deviceScaleFactor: 2 })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto('http://localhost:8091/?doc=test&fresh')
  await page.waitForSelector('#canvas svg g.node')
  let done = await rect(page, '#canvas g.node', 'done')
  await page.mouse.click(done.cx, done.cy)
  await page.click('button[aria-label="Color: Violet"]')
  check('a node without a link has no badge', !(await look(page, 'done')).badge)
  done = await rect(page, '#canvas g.node', 'done')
  await page.mouse.click(done.cx, done.cy)
  await page.click('#add-detail')
  await page.click('#crumbs button:not([aria-current]):not(.delete-view)')
  await page.mouse.click(20, 700)
  const linked = await look(page, 'done')
  check('a linked node gets the corner badge', linked.badge)
  check('the badge uses the node\'s own class color', linked.badgeStroke === linked.outline, JSON.stringify(linked))
  check('and the thick outline', linked.width === '2.6px', linked.width)
  const svg = await page.$eval('#canvas > svg:not(.dc-overlay)', el => { const r = el.getBoundingClientRect(); return { x: r.x - 10, y: r.y - 10, width: r.width + 30, height: r.height + 20 } })
  await page.screenshot({ path: `${out}/badge-dark.png`, clip: svg })
  const badge = await page.evaluate(() => { const r = [...document.querySelectorAll('#canvas g.node')].find(n => n.querySelector('title').textContent === 'done').querySelector('.dc-link-badge circle').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
  await page.mouse.click(badge.x, badge.y)
  check('clicking the badge opens the view', (await crumbs(page)) === 'Checkout › Order placed', await crumbs(page))
  await page.click('#crumbs button:not([aria-current]):not(.delete-view)')

  const store = await rect(page, '#canvas g.cluster', 'cluster_store')
  await page.mouse.click(store.x + 6, store.y + store.h - 6)
  await page.click('#to-view')
  const opener = await rect(page, '#canvas g.node', 'store')
  await page.mouse.click(opener.x + 2, opener.cy)
  const ghost = await look(page, 'browse')
  check('a ghost has no badge and a normal outline, like the skill', !ghost.badge && ghost.width !== '2.6px', JSON.stringify(ghost))
  const g = await rect(page, '#canvas g.node', 'browse')
  await page.mouse.click(g.x + 2, g.cy)
  check('a ghost\'s border still takes you home', (await crumbs(page)) === '', await crumbs(page))
  check('no page errors', errors.length === 0, errors.join('\n'))
  await browser.close()
})()
