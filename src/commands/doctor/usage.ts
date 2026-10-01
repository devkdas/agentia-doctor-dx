import {Command, Flags} from '@oclif/core'
import {execFileSync} from 'node:child_process'

function runAgentia(args: string[], timeoutMs = 60_000): string {
  return execFileSync('agentia', args, {encoding: 'utf8', timeout: timeoutMs, stdio: ['ignore', 'pipe', 'pipe']})
}

interface Spender {
  command: string
  flag: string
  agent: string
  when: string
}

const SPENDERS: Spender[] = [
  {command: 'agentia test auto', flag: '--ai-summary', agent: 'test', when: 'failed terminal states only'},
  {command: 'agentia release audit', flag: '--ai-summary', agent: 'release', when: 'when explicitly requested'},
  {command: 'agentia release sprint', flag: '--ai-narrate', agent: 'release', when: 'when explicitly requested'},
  {command: 'agentia drift check', flag: '--ai-explain', agent: 'operate', when: 'drifted states only'},
  {command: 'agentia drift sync', flag: '--ai-explain', agent: 'operate', when: 'when explicitly requested'},
  {command: 'agentia fleet check', flag: '--ai-suggest', agent: 'plan', when: 'fleet-wide verdicts only'},
  {command: 'agentia fleet incident', flag: '--ai-diagnose', agent: 'operate', when: 'when explicitly requested'},
]

export default class DoctorUsage extends Command {
  static description =
    'Show live AI quota plus every suite command that can spend it. Read only.'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --warn-pct 30 --json',
  ]

  static flags = {
    'warn-pct': Flags.integer({description: 'Warn when remaining quota drops below this percent.', default: 20}),
    json: Flags.boolean({char: 'j', description: 'Machine readable JSON output.', default: false}),
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(DoctorUsage)
    const warnPct = Math.max(1, Math.min(99, (flags['warn-pct'] as number) ?? 20))
    const asJson = (flags.json as boolean) ?? false

    let limit: number | null = null
    let usage: number | null = null
    try {
      const parsed: any = JSON.parse(runAgentia(['ai', 'quota', 'get', '--json']))
      const r = parsed?.result ?? parsed
      if (typeof r?.limit === 'number') limit = r.limit
      if (typeof r?.usage === 'number') usage = r.usage
    } catch {
      const detail = 'Quota read failed. AI auth or gateway may be unreachable.'
      if (asJson) this.log(JSON.stringify({status: 'error', detail, spenders: SPENDERS}, null, 2))
      else this.log(detail)
      this.exit(1)
    }

    const remaining = limit !== null && usage !== null ? limit - usage : null
    const remainingPct = remaining !== null && (limit as number) > 0
      ? Math.round((remaining / (limit as number)) * 100)
      : null
    const low = remainingPct !== null && remainingPct < warnPct

    const payload = {
      status: low ? 'low' : 'ok',
      limit,
      usage,
      remaining,
      remainingPct,
      warnPct,
      spenders: SPENDERS,
      note: 'Counts come from the live platform quota. Per story or per sprint spend is not exposed by any CLI command, so this report pairs live quota with the inventory of commands that can spend it.',
    }
    if (asJson) {
      this.log(JSON.stringify(payload, null, 2))
    } else {
      this.log(`AI quota: ${usage ?? '?'} used of ${limit ?? '?'} (${remainingPct ?? '?'}% remaining).`)
      if (low) this.log(`Warning: remaining quota below ${warnPct}%. Prefer deterministic default runs until it recovers.`)
      this.log(`Suite AI spend surface (${SPENDERS.length} opt-in flags, all default off):`)
      for (const s of SPENDERS) this.log(`- ${s.command} ${s.flag} -> ${s.agent} agent, ${s.when}.`)
    }
  }
}
