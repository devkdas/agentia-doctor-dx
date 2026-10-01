import {Command, Flags} from '@oclif/core'
import {execFileSync} from 'node:child_process'
import {existsSync, readdirSync, statSync, readFileSync} from 'node:fs'
import {homedir} from 'node:os'
import {join, resolve} from 'node:path'

function sh(cmd: string, args: string[], cwd?: string, timeoutMs = 30_000): string {
  return execFileSync(cmd, args, {encoding: 'utf8', timeout: timeoutMs, stdio: ['ignore', 'pipe', 'pipe'], cwd})
}

interface Item {
  name: string
  status: 'pass' | 'warn'
  detail: string
  fix?: string
}

export default class DoctorHealth extends Command {
  static description =
    'Full hygiene report: runtime, plugins, skills, git, project config and stale state. Read only.'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --json',
  ]

  static flags = {
    json: Flags.boolean({char: 'j', description: 'Machine readable JSON report.', default: false}),
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(DoctorHealth)
    const asJson = (flags.json as boolean) ?? false
    const items: Item[] = []
    const cwd = process.cwd()

    const nodeMajor = Number(process.versions.node.split('.')[0] ?? 0)
    items.push(nodeMajor >= 18
      ? {name: 'runtime-node', status: 'pass', detail: `Node ${process.versions.node} meets the 18 minimum.`}
      : {name: 'runtime-node', status: 'warn', detail: `Node ${process.versions.node} is below the 18 minimum.`, fix: 'Upgrade Node to 18 or newer.'})

    try {
      const out = execFileSync('agentia', ['plugins', '--json'],
        {encoding: 'utf8', timeout: 30_000, maxBuffer: 10 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']})
      const parsed: any = JSON.parse(out)
      const list: any[] = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.result) ? parsed.result : Array.isArray(parsed?.plugins) ? parsed.plugins : []
      const names = list.map((p) => typeof p === 'string' ? p : (p?.name ?? '')).filter((n) => n !== '')
      items.push(names.length > 0
        ? {name: 'linked-plugins', status: 'pass', detail: `${names.length} linked plugins: ${names.slice(0, 12).join(', ')}${names.length > 12 ? ' and more' : ''}.`}
        : {name: 'linked-plugins', status: 'warn', detail: 'No linked plugins detected.', fix: 'Link companion plugins with agentia plugins link before demos.'})
    } catch {
      items.push({name: 'linked-plugins', status: 'warn', detail: 'Plugin inventory unreadable.', fix: 'Run agentia plugins and confirm the linker is healthy.'})
    }

    for (const target of ['.agents/skills', '.cursor/skills', '.claude/skills']) {
      const dir = join(cwd, target)
      let count = 0
      try {
        if (existsSync(dir) && statSync(dir).isDirectory()) {
          count = readdirSync(dir).filter((e) => existsSync(join(dir, e, 'SKILL.md'))).length
        }
      } catch {
        count = 0
      }
      items.push(count > 0
        ? {name: `skills-${target}`, status: 'pass', detail: `${count} skills installed under ${target}.`}
        : {name: `skills-${target}`, status: 'warn', detail: `No skills under ${target} in this directory.`})
    }

    try {
      sh('git', ['rev-parse', '--show-toplevel'], cwd)
      const porcelain = sh('git', ['status', '--porcelain'], cwd).trim()
      const branch = sh('git', ['branch', '--show-current'], cwd).trim()
      items.push(porcelain === ''
        ? {name: 'git-tree', status: 'pass', detail: `Clean tree on branch ${branch || 'detached'}.`}
        : {name: 'git-tree', status: 'warn', detail: 'Uncommitted changes present.', fix: 'Review with git status and commit or stash before recording.'})
    } catch {
      items.push({name: 'git-tree', status: 'warn', detail: 'Not inside a git repository.'})
    }

    const hasProjectConfig = existsSync(join(cwd, '.agentia', 'config.json'))
    items.push(hasProjectConfig
      ? {name: 'project-config', status: 'pass', detail: 'Project config present in this directory.'}
      : {name: 'project-config', status: 'warn', detail: 'No project config here. Defaults avoid repeating flags.', fix: 'Run agentia setup in the project directory.'})

    const stale: string[] = []
    for (const file of [join(homedir(), '.agentia-gov-guard', 'pending.json'), join(homedir(), '.agentia-data-vault', 'pending.json')]) {
      try {
        if (existsSync(file)) {
          const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
          const now = Date.now()
          const live = Array.isArray(parsed) ? parsed.filter((r: any) => Date.parse(r?.expiresAt ?? 0) > now) : []
          if (live.length > 0) stale.push(`${file} holds ${live.length} live approval codes`)
        }
      } catch {
        stale.push(`${file} is unreadable and may hold stale codes`)
      }
    }
    items.push(stale.length === 0
      ? {name: 'stale-approvals', status: 'pass', detail: 'No live approval codes lying around.'}
      : {name: 'stale-approvals', status: 'warn', detail: stale.join(' '), fix: 'Consume or delete stale codes before recording so takes start clean.'})

    const warned = items.filter((i) => i.status === 'warn')
    const payload = {
      status: warned.length === 0 ? 'healthy' : 'attention',
      directory: cwd,
      warnCount: warned.length,
      items,
      fixes: items.filter((i) => i.fix).map((i) => i.fix as string),
    }
    if (asJson) {
      this.log(JSON.stringify(payload, null, 2))
    } else {
      this.log(`Hygiene report for ${cwd}: ${payload.status.toUpperCase()} (${warned.length} warnings).`)
      for (const i of items) {
        this.log(`[${i.status === 'pass' ? 'PASS' : 'WARN'}] ${i.name}: ${i.detail}`)
        if (i.fix) this.log(`      Fix: ${i.fix}`)
      }
    }
  }
}
