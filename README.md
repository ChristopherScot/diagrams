# diagrams

Owned by me-myself-and-i.

## Usage

An editor and store for drill-down Graphviz diagrams: one DOT file per
diagram, several views per file (one `digraph` each), browsed by clicking
from a summary into more detailed views. The format is described in
`format.ts` (served at `/format.md` and as the MCP resource
`diagrams://guide`).

| address | what it is |
|---|---|
| `/` | the library: every diagram, search, new, import |
| `/d/<id>-<slug>#<view>` | a diagram in the editor. Only `<id>` matters, so renaming never breaks a link |
| `/d/<id>.dot` | the raw DOT |
| `/d/<id>.svg?theme=dark&view=<view>` | a drawing of one view, with the house look written in |
| `/api/diagrams` | `GET` list, `POST` create (DOT body) |
| `/api/diagrams/<id>` | `GET`, `PUT` (optional `If-Match: "<version>"`), `DELETE` |
| `/api/diagrams/<id>/outline` | the view tree, ghosts, boxes and legend as JSON |
| `/mcp` | MCP over streamable HTTP (stateless) |

Every save, from the editor, the API or MCP, is checked against the same
rules: the view rules in `lib/dot-views.js` and Graphviz itself
(`@viz-js/viz`, the same build the browser uses). A refused save says why.

### Layout

| path | what |
|---|---|
| `lib/` | the editor's modules: DOT editing, views, Whole map, export, library. Shared by the page and the server |
| `web/index.html` | the editor page |
| `server.ts` | routes; `diagrams.ts` the service; `store.ts` storage; `mcp.ts` the MCP tools; `format.ts` the format guide |
| `test/` | unit tests for `lib/` |
| `e2e/` | browser tests (`npm run e2e`) |

### Storage

`STORAGE=folder` (default) keeps `<id>.dot` files in `DIAGRAMS_DIR`
(default `./drafts`), with the previous save as `.bak` and deletions in
`.trash/`.

`STORAGE=garage` keeps `diagrams/<id>.dot` in an S3 bucket
(`S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`),
the previous version of each save under `history/<id>/` and deletions
under `trash/`. The bucket and key are made once by hand:

```sh
VAULT_TOKEN="$(op item get homelab-vault-root --fields password --reveal)" bash scripts/garage-setup.sh
homelabctl vault --apply
```

`PUBLIC_URL` is the base the MCP tools use for links.

### MCP

```sh
claude mcp add --transport http diagrams https://diagrams.home.chrisscotmartin.com/mcp
```

Tools: `list_diagrams`, `read_diagram`, `create_diagram`, `write_diagram`,
`edit_diagram` (the editor's own edits, so a rename follows everywhere),
`delete_diagram`, `link_for`. Writes take the `version` you last read as
`if_version`.

### Running it locally

```sh
nvm use               # Node 24
npm install
DIAGRAMS_DIR=~/diagrams npm start     # http://localhost:3000
```

`npm run build:artifact` writes `dist/artifact.html`, the same editor as a
single page for a claude.ai artifact (Graphviz from a CDN, storage in the
artifact).

## Build

```sh
make build            # the production bundle: dist/server.js and dist/web/
make run              # start it on :3000
make run-dist         # the bundle, from an empty directory
```

`make run` uses `npm start`, which passes flags the server needs; running
`node server.ts` directly fails in ways that look like a code problem.

`make run-dist` is the one worth knowing about. The image copies
`dist/server.js` and `dist/web/` and nothing else — no `node_modules`, no source — so
anything read from disk at runtime resolves in a repo checkout and 500s
in the container. This reproduces the image's layout locally.

## Testing

```sh
make test             # typecheck, then the unit, API and MCP tests. What CI runs.
npm run e2e           # browser tests against a throwaway server on :8091
```

`npm run e2e` needs a Chromium matching playwright-core
(`npx playwright-core install chromium` once).

## Scale to zero

The pod sleeps after 15 idle minutes and wakes on the next request
(KEDA HTTP add-on, `deploy/diagrams/scale-to-zero.yaml`). Every request, MCP and API included, is held until the pod is
ready rather than answered with a waking page.

Two generated files carry hand edits for it, and `homelabctl render`
rewrites both without them. After a render, put them back:

- `deploy/diagrams/deployment.yaml`: delete `replicas:`
- `deploy/diagrams/ingress.yaml`: backend `keda-http-interceptor`, port `8080`

and keep `scale-to-zero.yaml` listed in `deploy/diagrams/kustomization.yaml`.

## Deploy

CI builds and pushes an image on every push to `main`;
argocd-image-updater rolls it out. Nothing to run by hand.

```sh
homelabctl check deploy   # manifests and config
homelabctl status         # what Argo made of it
homelabctl diff           # what would change in the GitOps repo
```

Manifests are generated from `config.yaml` by `homelabctl render` —
change the config, not `deploy/`.
