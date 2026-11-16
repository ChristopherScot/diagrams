import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const vizDir = join(root, 'node_modules', '@viz-js', 'viz')
const vizPackage = JSON.parse(readFileSync(join(vizDir, 'package.json'), 'utf8'))
const vizFile = join(vizDir, 'dist', 'viz-global.js')
const artifact = process.argv.includes('--artifact')
const VIZ_SRC = artifact ? `https://cdn.jsdelivr.net/npm/@viz-js/viz@${vizPackage.version}/dist/viz-global.js` : '/viz.js'

const IMPORT = /^import \{([^}]*)\} from '\.\.?\/(?:lib\/)?([\w-]+)\.js'\n/gm
const EXPORT = /^export (?:async )?(?:function|const|class|let) ([A-Za-z_$][\w$]*)/gm
const variable = name => `__${name.replace(/-/g, '_')}`

function bindings(list) {
  return list
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => part.replace(/\s+as\s+/, ': '))
    .join(', ')
}

function bundleModule(name, seen, out) {
  if (seen.has(name)) return
  seen.add(name)
  const source = readFileSync(join(root, 'lib', `${name}.js`), 'utf8')
  for (const [, , dependency] of source.matchAll(IMPORT)) bundleModule(dependency, seen, out)
  const exported = [...source.matchAll(EXPORT)].map(match => match[1])
  const body = source
    .replace(IMPORT, (_, list, dependency) => `const { ${bindings(list)} } = ${variable(dependency)}\n`)
    .replace(/^export /gm, '')
  out.push(`const ${variable(name)} = (() => {\n${body}\nreturn { ${exported.join(', ')} }\n})()\n`)
}

const page = readFileSync(join(root, 'web', 'index.html'), 'utf8')
const head = /^[\s\S]*?<body>/.exec(page)[0]
const title = /<title>[\s\S]*?<\/title>/.exec(page)[0]
const style = /<style>[\s\S]*?<\/style>/.exec(page)[0]
const body = /<body>([\s\S]*?)<script src=/.exec(page)[1]
const app = /<script type="module">([\s\S]*?)<\/script>/.exec(page)[1]

const modules = []
const seen = new Set()
for (const [, , dependency] of app.matchAll(IMPORT)) bundleModule(dependency, seen, modules)
const appBody = app.replace(IMPORT, (_, list, dependency) => `const { ${bindings(list)} } = ${variable(dependency)}\n`)
const scripts = `<script src="${VIZ_SRC}"></script>
<script type="module">
${modules.join('\n')}
${appBody.trim()}
</script>`

mkdirSync(join(root, 'dist', 'web'), { recursive: true })
if (artifact) {
  const output = `${title}\n${style}\n${body.trim()}\n${scripts}\n`
  writeFileSync(join(root, 'dist', 'artifact.html'), output)
  console.log(`dist/artifact.html: ${(output.length / 1024).toFixed(1)} KB`)
} else {
  const output = `${head}\n${body.trim()}\n${scripts}\n</body>\n</html>\n`
  writeFileSync(join(root, 'dist', 'web', 'index.html'), output)
  copyFileSync(vizFile, join(root, 'dist', 'web', 'viz.js'))
  console.log(`dist/web/index.html: ${(output.length / 1024).toFixed(1)} KB, modules: ${[...seen].join(', ')}`)
}
