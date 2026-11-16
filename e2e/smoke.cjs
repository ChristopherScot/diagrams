const { chromium } = require('playwright-core')
const { connect } = require('./helpers.cjs')
const out = process.env.E2E_OUT

const nodeBox = (page, id) =>
  page.evaluate(id => {
    const g = [...document.querySelectorAll('#canvas g.node')].find(g => g.querySelector('title').textContent === id)
    const r = g.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  }, id)
const groupBox = (page, selector, title) =>
  page.evaluate(([selector, title]) => {
    const g = [...document.querySelectorAll(selector)].find(g => g.querySelector('title').textContent === title)
    const t = g.querySelector('text') || g
    const r = t.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  }, [selector, title])
const source = page => page.$eval('#source', el => el.value)
const check = (name, ok, detail = '') => console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `\n${detail}`}`)

;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1300, height: 760 } })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => m.type() === 'error' && errors.push(m.text()))
  await page.goto('http://localhost:8091/?doc=test&fresh')
  await page.waitForSelector('#canvas svg g.node')

  let p = await nodeBox(page, 'cart')
  await page.mouse.dblclick(p.x, p.y)
  await page.waitForSelector('.dc-editor')
  await page.keyboard.type('Basket')
  await page.keyboard.press('Enter')
  check('rename node', (await source(page)).includes('basket [label=Basket]'), await source(page))

  const b = await nodeBox(page, 'basket')
  await connect(page, 'node', 'done', b)
  check('connect two nodes', (await source(page)).includes('done -> basket'), await source(page))

  const canvasBox = await page.$eval('#canvas', el => { const r = el.getBoundingClientRect(); return { x: r.x, bottom: r.bottom } })
  await connect(page, 'node', 'pay', { x: canvasBox.x + 280, y: canvasBox.bottom - 30 })
  await page.waitForSelector('.dc-editor')
  await page.keyboard.press('Meta+A')
  await page.keyboard.type('Refund')
  await page.keyboard.press('Enter')
  let s = await source(page)
  check('drag to empty space adds a connected node', s.includes('refund [label=Refund]') && s.includes('pay -> refund'), s)

  p = await groupBox(page, '#canvas g.edge', 'pay->done')
  await page.mouse.click(p.x, p.y)
  await page.keyboard.press('Delete')
  s = await source(page)
  check('delete edge', !s.includes('pay -> done') && s.includes('done [label'), s)

  p = await groupBox(page, '#canvas g.cluster', 'cluster_store')
  await page.mouse.dblclick(p.x, p.y)
  await page.waitForSelector('.dc-editor')
  await page.keyboard.press('Meta+A')
  await page.keyboard.type('Shop')
  await page.keyboard.press('Enter')
  check('rename cluster', (await source(page)).includes('label=Shop'), await source(page))

  p = await groupBox(page, '#canvas g.edge', 'basket->pay')
  await page.mouse.dblclick(p.x, p.y)
  await page.waitForSelector('.dc-editor')
  await page.keyboard.press('Meta+A')
  await page.keyboard.type('Go to')
  await page.keyboard.press('Shift+Enter')
  await page.keyboard.type('pay')
  await page.keyboard.press('Enter')
  s = await source(page)
  check('rename edge with a line break', s.includes('basket -> pay [label="Go to\\npay"]'), s)

  await page.screenshot({ path: `${out}/playground.png` })
  await page.click('#undo')
  s = await source(page)
  check('undo restores previous text', s.includes('basket -> pay [label="checkout"]'), s)

  p = await nodeBox(page, 'refund')
  await page.mouse.click(p.x, p.y)
  await page.keyboard.press('Backspace')
  s = await source(page)
  check('delete node', !s.includes('refund'), s)

  check('no page errors', errors.length === 0, errors.join('\n'))
  console.log('----\n' + s)
  await browser.close()
})()
