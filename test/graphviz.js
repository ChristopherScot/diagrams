import { instance } from '@viz-js/viz'

const viz = await instance()

export function dotRun(args, { input }) {
  const format = args.find(arg => arg.startsWith('-T'))?.slice(2) ?? 'svg'
  const result = viz.render(input, { format })
  const problems = (result.errors ?? []).map(error => `${error.level === 'warning' ? 'Warning' : 'Error'}: ${error.message.trim()}`)
  return { status: result.status === 'success' ? 0 : 1, stdout: result.output ?? '', stderr: problems.join('\n') }
}
