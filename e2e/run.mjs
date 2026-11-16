import { spawn } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..')
const work = mkdtempSync(path.join(tmpdir(), 'diagrams-e2e-'))
const diagrams = path.join(work, 'diagrams')
const env = { ...process.env, PORT: '8091', STORAGE: 'folder', DIAGRAMS_DIR: diagrams, E2E_OUT: work }

const server = spawn(process.execPath, ['server.ts'], { cwd: root, env, stdio: ['ignore', 'ignore', 'inherit'] })
const stop = () => server.kill()
process.on('exit', stop)

async function ready() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      if ((await fetch('http://localhost:8091/healthz')).ok) return
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  throw new Error('the server did not start on :8091 (is something else using it?)')
}

function run(file) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [path.join(here, file)], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', chunk => { output += chunk })
    child.stderr.on('data', chunk => { output += chunk })
    child.on('close', code => resolve({ output, code }))
  })
}

await ready()
const wanted = process.argv.slice(2)
const files = readdirSync(here).filter(name => name.endsWith('.cjs') && name !== 'helpers.cjs' && (wanted.length === 0 || wanted.includes(name.replace(/\.cjs$/, ''))))
let failed = 0
for (const file of files) {
  const { output, code } = await run(file)
  const passes = (output.match(/^PASS /gm) ?? []).length
  const fails = output.split('\n').filter(line => line.startsWith('FAIL ')).length + (code === 0 ? 0 : 1)
  failed += fails
  console.log(`${fails === 0 ? 'ok  ' : 'FAIL'} ${file.replace(/\.cjs$/, '')}: ${passes} passed${fails ? `, ${fails} failed` : ''}`)
  if (fails > 0) console.log(output.split('\n').filter(line => !line.startsWith('PASS ')).join('\n').trim().replace(/^/gm, '     '))
}
stop()
rmSync(work, { recursive: true, force: true })
process.exit(failed === 0 ? 0 : 1)
