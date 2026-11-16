const { chromium } = require('playwright-core')
const fs = require('fs')
const { spawnSync } = require('child_process')
const check = (name, ok, detail = '') => console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : '\n' + detail}`)
;(async () => {
  fs.copyFileSync(__dirname + '/fixtures/map.dot', process.env.DIAGRAMS_DIR + '/bugs.dot')
  const browser = await chromium.launch()
  const page = await browser.newPage({ acceptDownloads: true })
  await page.goto('http://localhost:8091/')
  await page.waitForSelector('.card[data-id="bugs"]')
  for (const theme of ['light', 'dark']) {
    await page.click('.card[data-id="bugs"] .card-menu')
    const [download] = await Promise.all([page.waitForEvent('download'), page.click(`#context-menu button[data-action="export-${theme}"]`)])
    const file = process.env.E2E_OUT + `/export-${theme}.dot`
    await download.saveAs(file)
    const text = fs.readFileSync(file, 'utf8')
    const r = spawnSync('dot', ['-Tpng', '-o', process.env.E2E_OUT + `/export-${theme}.png`], { input: text.slice(0, text.indexOf('\ndigraph', 10) > 0 ? text.indexOf('\ndigraph', 10) : undefined), encoding: 'utf8' })
    check(`Export ${theme} downloads ${download.suggestedFilename()} and plain dot draws it cleanly`, download.suggestedFilename() === `bugs-checkout-${theme}.dot` && r.status === 0 && r.stderr.trim() === '', r.stderr)
  }
  await browser.close()
})()
