const { chromium, devices } = require('playwright-core')
const { rect, handle } = require('./helpers.cjs')
const out = process.env.E2E_OUT
const check = (name, ok, detail = '') => console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : '\n' + detail}`)
const source = page => page.$eval('#source', el => el.value)
const FAN = 'digraph fan {\n  node [shape=box]\n  a -> b\n  a -> c\n  a -> d\n}\n'

async function gripDrop(page, node, target, side, { hold } = {}) {
  const box = await rect(page, '#canvas g.node', node)
  await page.mouse.click(box.cx, box.cy)
  const grip = await handle(page, 'node', node, 'move')
  const t = await rect(page, '#canvas g.node', target)
  const point = {
    left: { x: t.x + t.w * 0.2, y: t.cy },
    right: { x: t.x + t.w * 0.8, y: t.cy },
    top: { x: t.cx, y: t.y + t.h * 0.2 },
    bottom: { x: t.cx, y: t.y + t.h * 0.8 },
  }[side]
  await page.mouse.move(grip.x, grip.y)
  await page.mouse.down()
  await page.mouse.move(point.x, point.y, { steps: 15 })
  if (hold) await hold()
  await page.mouse.up()
}

;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1300, height: 760 } })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto('http://localhost:8091/?doc=test&fresh')
  await page.waitForSelector('#canvas svg g.node')
  await page.click('#debug-toggle')
  await page.fill('#source', FAN)
  await page.waitForTimeout(700)

  await gripDrop(page, 'd', 'b', 'left', {
    hold: async () => check('dropping on a node shows an insertion bar beside it', (await page.$$('#canvas .dc-row-bar')).length === 1),
  })
  let s = await source(page)
  check('grip on the left side of b puts d before b in a row', s.includes('d -> b [style=invis]'), s)
  let d = await rect(page, '#canvas g.node', 'd')
  let b = await rect(page, '#canvas g.node', 'b')
  check('d is drawn to the left of b on the same row', d.cx < b.cx && Math.abs(d.cy - b.cy) < 2, JSON.stringify({ d, b }))
  check('no visible arrow was added', (s.match(/->/g) || []).length === 4, s)

  await gripDrop(page, 'c', 'd', 'left')
  const c = await rect(page, '#canvas g.node', 'c')
  d = await rect(page, '#canvas g.node', 'd')
  b = await rect(page, '#canvas g.node', 'b')
  check('c before d gives the order c, d, b', c.cx < d.cx && d.cx < b.cx, JSON.stringify({ c, d, b }))

  await gripDrop(page, 'c', 'b', 'right')
  const c2 = await rect(page, '#canvas g.node', 'c')
  b = await rect(page, '#canvas g.node', 'b')
  check('the right side puts c after b', c2.cx > b.cx, JSON.stringify({ c2, b }))

  const edgeLabel = await page.evaluate(() => {
    const g = [...document.querySelectorAll('#canvas g.edge')].find(e => e.querySelector('title').textContent === 'a->b')
    const r = g.querySelector('path:not(.dc-hit)').getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })
  await page.mouse.click(edgeLabel.x, edgeLabel.y)
  check('visible arrows are still selectable next to hidden row links', (await page.textContent('#selection')) === 'a → b', await page.textContent('#selection'))

  const cNow = await rect(page, '#canvas g.node', 'c')
  await page.mouse.click(cNow.cx, cNow.cy)
  check('the side panel shows the row in order', (await page.textContent('#row-text')) === 'In a row: d → b → c', await page.textContent('#row-text'))
  await page.click('#leave-row')
  s = await source(page)
  check('Leave row takes c out', s.includes('d -> b [style=invis]') && !s.includes('b -> c [style=invis]'), s)

  const dNow = await rect(page, '#canvas g.node', 'd')
  await page.mouse.click(dNow.cx, dNow.cy)
  const grip = await handle(page, 'node', 'd', 'move')
  const canvas = await page.$eval('#canvas', el => { const r = el.getBoundingClientRect(); return { right: r.right, bottom: r.bottom } })
  await page.mouse.move(grip.x, grip.y)
  await page.mouse.down()
  await page.mouse.move(canvas.right - 60, canvas.bottom - 60, { steps: 15 })
  await page.mouse.up()
  check('dropping the grip on empty canvas leaves the row (and a row of one goes away)', (await source(page)) === FAN, await source(page))

  await page.fill('#source', '')
  await page.click('#debug-toggle')
  await page.goto('http://localhost:8091/?doc=test&fresh')
  await page.waitForSelector('#canvas svg g.node')
  await gripDrop(page, 'done', 'pay', 'top')
  const done = await rect(page, '#canvas g.node', 'done')
  const pay = await rect(page, '#canvas g.node', 'pay')
  check('in the left-to-right sample, the top half puts it above, in the same column', done.cy < pay.cy && Math.abs(done.cx - pay.cx) < 3, JSON.stringify({ done, pay }))
  s = await source(page)
  check('a row across a box turns on newrank', s.includes('newrank=true') && s.includes('done -> pay [style=invis]'), s)
  await page.screenshot({ path: `${out}/rows.png` })
  check('no page errors', errors.length === 0, errors.join('\n'))

  const phone = await (await browser.newContext({ ...devices['iPhone 13'] })).newPage()
  await phone.goto('http://localhost:8091/?doc=test&fresh')
  await phone.waitForSelector('#canvas svg g.node', { timeout: 30000 })
  const pc = await rect(phone, '#canvas g.node', 'cart')
  await phone.touchscreen.tap(pc.cx, pc.cy)
  const pg = await handle(phone, 'node', 'cart', 'move')
  const pp = await rect(phone, '#canvas g.node', 'pay')
  const cdp = await phone.context().newCDPSession(phone)
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] })
  const target = { x: pp.cx, y: pp.y + pp.h * 0.8 }
  await touch('touchStart', pg.x, pg.y)
  for (let k = 1; k <= 12; k += 1) await touch('touchMove', pg.x + (target.x - pg.x) * k / 12, pg.y + (target.y - pg.y) * k / 12)
  await touch('touchEnd')
  await phone.waitForTimeout(300)
  check('on a phone, the grip lines a node up after another', (await source(phone)).includes('pay -> cart [style=invis]'), await source(phone))
  await browser.close()
})()
