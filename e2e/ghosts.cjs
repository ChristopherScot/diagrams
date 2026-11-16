const { chromium } = require('playwright-core')
const { rect } = require('./helpers.cjs')
const out = process.env.E2E_OUT
const check = (name, ok, detail = '') => console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : '\n' + detail}`)
const source = page => page.$eval('#source', el => el.value)
const crumbs = page => page.$$eval('#crumbs button:not(.delete-view)', bs => bs.map(b => b.textContent).join(' › '))

async function rename(page, node, text) {
  const box = await rect(page, '#canvas g.node', node)
  await page.mouse.dblclick(box.cx, box.cy)
  await page.waitForSelector('.dc-editor')
  await page.keyboard.press('Meta+A')
  await page.keyboard.type(text)
  await page.keyboard.press('Enter')
}

;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1300, height: 760 } })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto('http://localhost:8091/?doc=test&fresh')
  await page.waitForSelector('#canvas svg g.node')
  const store = await rect(page, '#canvas g.cluster', 'cluster_store')
  await page.mouse.click(store.x + 6, store.y + store.h - 6)
  await page.click('#to-view')

  await page.click('#new-button')
  await page.click('#new-ghost')
  const listed = await page.$$eval('#ghost-list button', bs => bs.map(b => b.textContent))
  check('From another view lists the other views\' own nodes, not their ghosts', JSON.stringify(listed) === JSON.stringify(['Cart', 'Payment']), listed.join(','))
  check('they are grouped under the view they live in', (await page.textContent('#ghost-list h3')) === 'Store')
  await page.fill('#ghost-search', 'pay')
  check('search narrows the list', JSON.stringify(await page.$$eval('#ghost-list button', bs => bs.map(b => b.textContent))) === JSON.stringify(['Payment']))
  await page.fill('#ghost-search', '')
  await page.click('#ghost-list button[data-node="cart"]')
  let s = await source(page)
  check('picking one adds it here as a ghost that links home', s.includes('cart [label=Cart, class=ghost, URL="#store"]'), s)
  const dash = await page.evaluate(() => { const g = [...document.querySelectorAll('#canvas g.node')].find(n => n.querySelector('title').textContent === 'cart'); return getComputedStyle(g.querySelector('path, polygon')).strokeDasharray })
  check('it is drawn as a ghost', dash !== 'none', dash)
  await page.screenshot({ path: `${out}/ghost-added.png` })

  await page.click('#new-button')
  await page.click('#new-ghost')
  check('a node already here can\'t be added twice', await page.$eval('#ghost-list button[data-node="cart"]', b => b.disabled && b.textContent.includes('already here')))
  await page.click('#ghost-close')

  await rename(page, 'browse', 'Shop')
  s = await source(page)
  check('renaming a node renames every copy without asking', (s.match(/label=Shop/g) || []).length === 2 && (await page.$eval('#prompt', el => el.hidden)), s)

  await rename(page, 'cart', 'Basket')
  s = await source(page)
  check('renaming a ghost renames its home too', s.includes('basket [label=Basket, class=ghost') && s.includes('basket [label=Basket]'), s)

  const ghost = await rect(page, '#canvas g.node', 'basket')
  await page.mouse.click(ghost.x + 2, ghost.cy)
  check('a ghost\'s border takes you to where it lives', (await crumbs(page)) === 'Checkout › Store', await crumbs(page))
  check('no page errors', errors.length === 0, errors.join('\n'))
  await browser.close()
})()
