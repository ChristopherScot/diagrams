const rect = (page, selector, title) => page.evaluate(([selector, title]) => {
  const g = [...document.querySelectorAll(selector)].find(g => g.querySelector('title').textContent === title)
  const r = g.getBoundingClientRect()
  return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 }
}, [selector, title])

const handle = (page, kind, id, action = 'connect') => page.evaluate(([kind, id, action]) => {
  const circle = [...document.querySelectorAll('#canvas .dc-handle-hit')].find(c => c.dataset.kind === kind && c.dataset.id === id && c.dataset.action === action)
  if (circle == null) return null
  const r = circle.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
}, [kind, id, action])

async function dragMouse(page, from, to, steps = 12) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps })
  await page.mouse.move(to.x, to.y, { steps })
  await page.mouse.up()
}

async function connect(page, kind, id, to) {
  const selector = kind === 'node' ? '#canvas g.node' : '#canvas g.cluster'
  const box = await rect(page, selector, id)
  if (kind === 'node') await page.mouse.click(box.cx, box.cy)
  else await page.mouse.click(box.x + 6, box.y + box.h - 6)
  const start = await handle(page, kind, id)
  if (start == null) throw new Error(`no handle for ${kind} ${id}`)
  await dragMouse(page, start, to)
}

async function moveWithGrip(page, id, to) {
  const box = await rect(page, '#canvas g.node', id)
  await page.mouse.click(box.cx, box.cy)
  const grip = await handle(page, 'node', id, 'move')
  if (grip == null) throw new Error(`no grip for ${id}`)
  await dragMouse(page, grip, to)
}

async function startBox(page) {
  await page.click('#new-button')
  await page.click('#new-box')
}

module.exports = { rect, handle, dragMouse, connect, moveWithGrip, startBox }
