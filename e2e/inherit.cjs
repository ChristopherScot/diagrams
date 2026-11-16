const { chromium } = require('playwright-core')
const { rect, dragMouse } = require('./helpers.cjs')
const check = (name, ok, detail = '') => console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : '\n' + detail}`)
const source = page => page.$eval('#source', el => el.value)

async function dragToEmpty(page, node) {
  const box = await rect(page, '#canvas g.node', node)
  const canvas = await page.$eval('#canvas', el => { const r = el.getBoundingClientRect(); return { right: r.right, bottom: r.bottom } })
  await dragMouse(page, { x: box.cx, y: box.cy }, { x: canvas.right - 80, y: canvas.bottom - 80 })
  await page.waitForSelector('.dc-editor')
  await page.keyboard.press('Enter')
}

;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1300, height: 760 } })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto('http://localhost:8091/?doc=test&fresh')
  await page.waitForSelector('#canvas svg g.node')

  const cart = await rect(page, '#canvas g.node', 'cart')
  await page.mouse.click(cart.cx, cart.cy)
  await page.click('button[aria-label="Color: Amber"]')
  await page.click('button[aria-label="Diamond"]')
  await page.click('button[aria-label="Dashed"]')
  await dragToEmpty(page, 'cart')
  let s = await source(page)
  check('a node made from a styled node copies its class, shape and line style', /new_node \[label="New node", class=amber, shape=diamond, style="rounded,filled,dashed"\]/.test(s), s)
  check('and is connected to it', s.includes('cart -> new_node'))

  await dragToEmpty(page, 'pay')
  s = await source(page)
  check('a node made from a plain node stays plain', s.includes('new_node_2 [label="New node"]\n'), s)

  const store = await rect(page, '#canvas g.cluster', 'cluster_store')
  await page.mouse.click(store.x + 6, store.y + store.h - 6)
  await page.click('#to-view')
  const opener = await rect(page, '#canvas g.node', 'store')
  await page.mouse.click(opener.x + 2, opener.cy)
  await dragToEmpty(page, 'browse')
  s = await source(page)
  const store2 = s.slice(s.indexOf('digraph store'))
  check('a node made from a ghost is not a ghost and links nowhere', /new_node_3 \[label="New node"\]\n/.test(store2) && !/new_node_3 \[[^\]]*(ghost|URL)/.test(store2), store2)
  check('no page errors', errors.length === 0, errors.join('\n'))
  await browser.close()
})()
