import { promises as fs, existsSync } from 'node:fs'
import path from 'node:path'
import { AwsClient } from 'aws4fetch'

export type Stored = { id: string, text: string, updated: number }

export interface Store {
  readonly kind: string
  list(): Promise<Stored[]>
  read(id: string): Promise<Stored | null>
  write(id: string, text: string): Promise<void>
  remove(id: string): Promise<void>
}

const STEM = /^[a-z0-9]+$/

export function folderStore(dir: string): Store {
  const fileOf = (id: string) => path.join(dir, `${id}.dot`)
  const trash = path.join(dir, '.trash')
  return {
    kind: 'folder',
    async list() {
      await fs.mkdir(dir, { recursive: true })
      const names = (await fs.readdir(dir)).filter(name => name.endsWith('.dot') && STEM.test(name.slice(0, -4)))
      const found = await Promise.all(names.map(name => this.read(name.slice(0, -4))))
      return found.filter((entry): entry is Stored => entry != null)
    },
    async read(id) {
      if (!STEM.test(id) || !existsSync(fileOf(id))) return null
      const [text, stat] = await Promise.all([fs.readFile(fileOf(id), 'utf8'), fs.stat(fileOf(id))])
      return { id, text, updated: Math.round(stat.mtimeMs) }
    },
    async write(id, text) {
      await fs.mkdir(dir, { recursive: true })
      const file = fileOf(id)
      if (existsSync(file)) await fs.copyFile(file, `${file}.bak`)
      await fs.writeFile(`${file}.tmp`, text)
      await fs.rename(`${file}.tmp`, file)
    },
    async remove(id) {
      await fs.mkdir(trash, { recursive: true })
      await fs.rename(fileOf(id), path.join(trash, `${id}-${Date.now()}.dot`))
    },
  }
}

export type GarageOptions = {
  endpoint: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  region?: string
}

function xmlValues(xml: string, tag: string): string[] {
  return [...xml.matchAll(new RegExp(`<${tag}>([^<]*)</${tag}>`, 'g'))].map(match => match[1])
}

export function garageStore({ endpoint, bucket, accessKeyId, secretAccessKey, region = 'garage' }: GarageOptions): Store {
  const client = new AwsClient({ accessKeyId, secretAccessKey, region, service: 's3' })
  const base = `${endpoint.replace(/\/$/, '')}/${encodeURIComponent(bucket)}`
  const objectUrl = (key: string) => `${base}/${key.split('/').map(encodeURIComponent).join('/')}`
  const call = async (url: string, init: RequestInit = {}, allowed: number[] = []) => {
    const response = await client.fetch(url, init)
    if (!response.ok && !allowed.includes(response.status)) {
      throw new Error(`Garage said ${response.status} for ${init.method ?? 'GET'} ${url.slice(base.length)}: ${(await response.text()).slice(0, 200)}`)
    }
    return response
  }
  const keyOf = (id: string) => `diagrams/${id}.dot`
  return {
    kind: 'garage',
    async list() {
      const ids: string[] = []
      let token: string | null = null
      do {
        const query = new URLSearchParams({ 'list-type': '2', prefix: 'diagrams/' })
        if (token != null) query.set('continuation-token', token)
        const xml = await (await call(`${base}?${query}`)).text()
        for (const key of xmlValues(xml, 'Key')) {
          const id = key.slice('diagrams/'.length, -'.dot'.length)
          if (key.endsWith('.dot') && STEM.test(id)) ids.push(id)
        }
        token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? xmlValues(xml, 'NextContinuationToken')[0] ?? null : null
      } while (token != null)
      const found = await Promise.all(ids.map(id => this.read(id)))
      return found.filter((entry): entry is Stored => entry != null)
    },
    async read(id) {
      if (!STEM.test(id)) return null
      const response = await call(objectUrl(keyOf(id)), {}, [404])
      if (response.status === 404) return null
      const modified = Date.parse(response.headers.get('last-modified') ?? '')
      return { id, text: await response.text(), updated: Number.isNaN(modified) ? Date.now() : modified }
    },
    async write(id, text) {
      const previous = await this.read(id)
      if (previous != null) {
        await call(objectUrl(`history/${id}/${new Date(previous.updated).toISOString()}.dot`), { method: 'PUT', body: previous.text, headers: { 'content-type': 'text/vnd.graphviz' } })
      }
      await call(objectUrl(keyOf(id)), { method: 'PUT', body: text, headers: { 'content-type': 'text/vnd.graphviz' } })
    },
    async remove(id) {
      const previous = await this.read(id)
      if (previous != null) {
        await call(objectUrl(`trash/${id}-${Date.now()}.dot`), { method: 'PUT', body: previous.text, headers: { 'content-type': 'text/vnd.graphviz' } })
      }
      await call(objectUrl(keyOf(id)), { method: 'DELETE' }, [404])
    },
  }
}

export function storeFromEnv(env: NodeJS.ProcessEnv = process.env): Store {
  if ((env.STORAGE ?? 'folder') === 'garage') {
    const need = (name: string) => {
      const value = env[name]
      if (!value) throw new Error(`STORAGE=garage needs ${name}`)
      return value
    }
    return garageStore({
      endpoint: env.S3_ENDPOINT ?? 'http://garage.garage.svc.cluster.local:3900',
      bucket: env.S3_BUCKET ?? 'diagrams',
      accessKeyId: need('S3_ACCESS_KEY_ID'),
      secretAccessKey: need('S3_SECRET_ACCESS_KEY'),
      region: env.S3_REGION ?? 'garage',
    })
  }
  return folderStore(path.resolve(env.DIAGRAMS_DIR ?? 'drafts'))
}
