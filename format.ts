export const INSTRUCTIONS = `Drill-down diagrams: each diagram is one Graphviz DOT file holding several views. Every \`digraph\` is a view; \`URL="#view-id"\` on a node or box opens another view; \`parent=\` nests a view under another; dashed ghosts (class=ghost) stand in for nodes that live in another view; \`class=\` plus the view's \`legend\` gives color meaning. Read the resource diagrams://guide before writing or editing a diagram. Every save is checked against the same rules as the editor, and a refused save says why. Pass the version you last read as if_version so you never overwrite someone else's change.`

export const GUIDE = `# The drill-down diagram format

A diagram is one plain Graphviz DOT file. It holds several **views**, one
\`digraph\` each. People browse it by clicking from a summary view into more
detailed ones, and edit it in the diagrams editor.

## Views

\`\`\`dot
digraph checkout {
  title="Checkout"
  caption="How an order goes from cart to paid. **Markdown** works here."
  notes="Optional longer text shown under the caption."
  legend="blue: Storefront, green: Fulfilment"
  rankdir=LR

  store [label="Store", URL="#store", class=blue]
  done  [label="Order placed", class=green]
  store -> done [label="paid"]
}

digraph store {
  title="Store"
  parent=checkout
  browse [label="Browse", class=ghost, URL="#checkout"]
  cart [label="Cart"]
  pay  [label="Payment"]
  browse -> cart [label="add"]
  cart -> pay
}
\`\`\`

- **View id** = the digraph name: lowercase letters, digits, hyphens
  (\`whole-map\` is reserved). Quote it when it has a hyphen.
- The **first** digraph is the top view; its \`title\` is the diagram's name.
- \`title\` names the view, \`parent\` (a view id) nests it, \`caption\` and
  \`notes\` are shown under the drawing and may use Markdown, with \`\\n\` for a
  new line. A Markdown link like \`[Store](#store)\` opens that view.
- Every \`parent\` must be an existing view and parents can't form a loop.

## Links between views

- \`URL="#view-id"\` on a node opens that view. The node gets a thick border.
  The view's \`parent\` should be the view that holds the node.
- Keep the **first line of a linked node's label equal to the title** of the
  view it opens. Renaming either renames the other.
- A box (cluster) can open a view too: \`URL="#view-id"\` on the subgraph.
- Every \`URL="#..."\` must name an existing view.

## Ghosts

A ghost is a node drawn in one view but defined in another:
\`id [label="Same label", class=ghost, URL="#home-view"]\`, where \`id\` is
the **same id** as the real node in its home view.

- Use ghosts only for arrows **coming into** a view from outside it. An arrow
  that leaves a view stays in the view that owns its source.
- A ghost's \`URL\` points at the view where the real node lives, never at
  another ghost. Ghosts are drawn dashed, in their home node's color.
- Node ids are unique across the whole file; two different things must not
  share an id in different views.

## Boxes

Boxes are \`subgraph cluster_<name> { label="..." ... }\` and can nest.
An arrow to or from a box uses an invisible anchor node inside it:

\`\`\`dot
subgraph cluster_store {
  label="Store"
  cluster_store_anchor [shape=point, style=invis, width=0, height=0, label=""]
  cart
}
done -> cluster_store_anchor [lhead=cluster_store]
\`\`\`

with \`compound=true\` on the view. The editor's \`addEdge\` with
\`{ cluster: "cluster_store" }\` writes this for you.

## Color

- Color is a **class**: \`class=blue\` (also \`green amber violet rose
  slate\`). Don't write hex colors; the editor picks light and dark colors
  from the class.
- \`legend="blue: Storefront, green: Fulfilment"\` names what each class
  means (use \`;\` between entries when a label has a comma).
- A new box around nodes that all share a class takes that class.

## Rows, order and arrows

- Same row: \`subgraph row_1 { rank=same; a -> b [style=invis] }\` keeps \`a\`
  then \`b\` side by side.
- A backward-facing arrow (pointing against the flow) is written
  \`b -> a [dir=back]\`: it is drawn from \`a\` to \`b\` without moving the layout.
- Line style carries meaning (\`style=dashed\`, \`style=dotted\`); say what it
  means in the caption.

## Ids and labels

- Node ids are snake_case slugs of the label (\`order_placed\`), numbered on a
  clash (\`new_node_2\`). Renaming a node whose id came from its label renames
  the id everywhere.
- One statement per line.

## Look

The house look (rounded filled boxes, Helvetica, spacing, colors for each
class) is applied when the diagram is drawn and isn't written into the file.
Use the .svg link or the editor's export to get a file other tools draw the
same way.

## Edits (edit_diagram)

Each edit is an object with a \`type\`; \`graph\` is the view id.

| type | fields |
|---|---|
| addNode | graph, node, attrs?, subgraph? (box id) |
| removeNode | graph, node |
| addEdge | graph, from, to (node id or { cluster }), attrs? |
| removeEdge | graph, edge: { from, to, index? } |
| setNodeAttr | graph, node, key, value (null removes) |
| setEdgeAttr | graph, edge: { from, to, index? }, key, value |
| setGraphAttr | graph, key, value, subgraph? (box id; omit for the view) |
| renameNode | graph, node, to (changes the id, not the label) |
| addCluster | graph, cluster ("cluster_<name>"), nodes?, clusters?, subgraph?, attrs? |
| moveNode | graph, node, to (box id or null for top level) |
| moveCluster | graph, cluster, to |
| placeInRow | graph, node, target, position ("before" or "after") |
| leaveRow | graph, node |
| addView | view, title, parent? |
| removeView | view |
| renameView | view, to |
| setLink | graph, node or subgraph, view (null removes the link) |
| clusterToView | graph, cluster, view? — turns a box into its own view |
| addGhost | graph, node, from (the home view) |

Setting a node's \`label\` renames it everywhere it appears (ghosts too) and
keeps a linked view's title in step, exactly as in the editor.
`
