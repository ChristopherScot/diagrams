export const NEUTRALS = [
  { name: 'Text', role: 'ink', light: '#1a1f2c', dark: '#e6e9ef' },
  { name: 'Muted', role: 'ink', light: '#5b6476', dark: '#98a1b3' },
  { name: 'Edge', role: 'ink', light: '#6a7387', dark: '#8f98ab' },
  { name: 'Border', role: 'ink', light: '#d6dae3', dark: '#333a48' },
  { name: 'Panel', role: 'surface', light: '#ffffff', dark: '#1a1e27' },
]

const tone = name => NEUTRALS.find(neutral => neutral.name === name).light

export const HOUSE_LAYOUT = {
  graphAttributes: {
    bgcolor: 'transparent',
    pad: '0.25',
    nodesep: '0.55',
    ranksep: '0.75',
    fontname: 'Helvetica',
    fontsize: '11',
    fontcolor: tone('Muted'),
    color: tone('Border'),
  },
  nodeAttributes: {
    shape: 'box',
    style: 'rounded,filled',
    margin: '0.2,0.1',
    fontname: 'Helvetica',
    fontsize: '14',
    fillcolor: tone('Panel'),
    color: tone('Edge'),
    fontcolor: tone('Text'),
  },
  edgeAttributes: {
    fontname: 'Helvetica',
    fontsize: '11',
    arrowsize: '0.7',
    color: tone('Edge'),
    fontcolor: tone('Muted'),
  },
}

export const HOUSE_DEFAULTS = {
  node: HOUSE_LAYOUT.nodeAttributes,
  edge: HOUSE_LAYOUT.edgeAttributes,
  cluster: { color: HOUSE_LAYOUT.graphAttributes.color, fontcolor: HOUSE_LAYOUT.graphAttributes.fontcolor },
}

export const HOUSE_CSS = `
.dot-canvas :where(svg text) { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; }
.dot-canvas :where(g.node text) { font-weight: 500; }
.dot-canvas :where(g.node > path, g.node > polygon, g.node > ellipse) { stroke-width: 1.4; }
.dot-canvas :where(g.edge > path:not(.dc-hit)) { stroke-width: 1.2; }
.dot-canvas :where(g.cluster > path, g.cluster > polygon) { stroke-width: 1.2; }
.dot-canvas :where(g.cluster > text) { letter-spacing: 0.06em; }
`
