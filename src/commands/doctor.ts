import {Command, Flags} from '@oclif/core'
import {execFileSync, spawnSync} from 'node:child_process'
import {existsSync} from 'node:fs'
import {join} from 'node:path'

type CheckStatus = 'pass' | 'warn' | 'block' | 'info'

interface HealthCheck {
  name: string
  status: CheckStatus
  detail: string
  fix?: string
}

function runAgentia(args: string[]): string {
  return execFileSync('agentia', args, {encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe']})
}

interface AuthState {
  cicdSet: boolean
  crtReady: boolean
  crtMissing: string[]
  crtIssueCount: number
  aiSet: boolean
  readable: boolean
}

function loadAuth(): AuthState {
  const fallback: AuthState = {
    cicdSet: false,
    crtReady: false,
    crtMissing: [],
    crtIssueCount: 0,
    aiSet: false,
    readable: false,
  }
  try {
    const parsed: any = JSON.parse(runAgentia(['auth', 'get', '--json']))
    const creds: any[] = parsed?.result?.credentials ?? []
    const byType = (t: string) => creds.find((c) => c?.type === t)
    const crt = byType('crt')
    return {
      cicdSet: Boolean(byType('cicd')?.set),
      crtReady: Boolean(crt?.ready),
      crtMissing: Array.isArray(crt?.missing) ? crt.missing : [],
      crtIssueCount: Array.isArray(crt?.issues) ? crt.issues.length : 0,
      aiSet: Boolean(byType('ai')?.set),
      readable: true,
    }
  } catch {
    return fallback
  }
}

function cliFreshness(): {fresh: boolean; detail: string} {
  try {
    const res = spawnSync('agentia', ['--version'], {encoding: 'utf8', timeout: 15_000})
    const combined = `${res.stdout ?? ''}\n${res.stderr ?? ''}`
    if (/update available/i.test(combined)) {
      const m = combined.match(/(\d+\.\d+\.\d+[-+a-zA-Z0-9.]*)\s+to\s+(\d+\.\d+\.\d+[-+a-zA-Z0-9.]*)/)
      const detail = m
        ? `CLI ${m[1]} can update to ${m[2]}. Agent Skills are versioned with the CLI, so refresh them after upgrading.`
        : 'A newer CLI alpha is available. Agent Skills are versioned with the CLI, so refresh them after upgrading.'
      return {fresh: false, detail}
    }
    return {fresh: true, detail: 'CLI reports no pending update notice.'}
  } catch {
    return {fresh: true, detail: 'Could not determine CLI freshness. Skipping staleness warning.'}
  }
}

export default class Doctor extends Command {
  static description = 'Check Agentia setup, auth and skills health with exact fix commands.'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --json',
    '<%= config.bin %> <%= command.id %> --story US-1234',
  ]

  static flags = {
    story: Flags.string({char: 's', description: 'User story ID to validate flow consistency for.'}),
    json: Flags.boolean({char: 'j', description: 'Machine readable JSON output.', default: false}),
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(Doctor)
    const story = flags.story ?? null
    const asJson = flags.json ?? false
    const checks: HealthCheck[] = []

    const auth = loadAuth()
    if (!auth.readable) {
      checks.push({
        name: 'auth-readable',
        status: 'block',
        detail: 'Could not read agentia auth state.',
        fix: 'Run agentia setup to authenticate this machine.',
      })
    }

    checks.push(
      auth.cicdSet
        ? {name: 'auth-cicd', status: 'pass', detail: 'CICD credentials are stored.'}
        : {
            name: 'auth-cicd',
            status: 'block',
            detail: 'CICD credentials are not stored. Most commands will fail.',
            fix: 'Run agentia setup to authenticate CICD.',
          },
    )

    if (auth.crtReady) {
      checks.push({name: 'auth-crt', status: 'pass', detail: 'CRT reports ready:true.'})
    } else {
      const missing = auth.crtMissing.length > 0 ? ` Missing: ${auth.crtMissing.join(', ')}.` : ''
      const issues = auth.crtIssueCount > 0 ? ` Issues reported: ${auth.crtIssueCount}.` : ''
      checks.push({
        name: 'auth-crt',
        status: 'warn',
        detail: `CRT is not ready. A stored credential alone is not a readiness signal.${missing}${issues}`,
        fix: 'Correct everything in missing or issues from agentia auth get --crt --json, then re-run doctor.',
      })
    }

    checks.push(
      auth.aiSet
        ? {name: 'auth-ai', status: 'pass', detail: 'AI credentials are stored.'}
        : {
            name: 'auth-ai',
            status: 'warn',
            detail: 'AI credentials are not stored. Agent ask and chat will fail.',
            fix: 'Run agentia setup to authenticate AI.',
          },
    )

    const fresh = cliFreshness()
    checks.push(
      fresh.fresh
        ? {name: 'cli-skills', status: 'pass', detail: fresh.detail}
        : {
            name: 'cli-skills',
            status: 'warn',
            detail: fresh.detail,
            fix: 'Run agentia update, then agentia setup skills update --target agents --no-prompt.',
          },
    )

    const projectConfig = join(process.cwd(), '.agentia', 'config.json')
    checks.push(
      existsSync(projectConfig)
        ? {name: 'project-config', status: 'pass', detail: `Project config found at ${projectConfig}.`}
        : {
            name: 'project-config',
            status: 'warn',
            detail: 'No project config in the current directory. Project defaults avoid repeating flags.',
            fix: 'Run agentia setup in the project, then set defaults once instead of passing flags every time.',
          },
    )

    checks.push(
      story
        ? {
            name: 'story-flow',
            status: 'info',
            detail: `Story ${story} given. Keep it entirely in the local flow or entirely in the cloud flow, since local and cloud operations cannot be mixed.`,
          }
        : {
            name: 'story-flow',
            status: 'info',
            detail: 'Local and cloud development flows cannot be mixed. Pick one flow per user story.',
          },
    )

    const blocked = checks.some((c) => c.status === 'block')
    const warned = checks.some((c) => c.status === 'warn')
    const status = blocked ? 'blocked' : warned ? 'attention' : 'healthy'
    const fixes = checks.filter((c) => c.fix).map((c) => c.fix as string)

    if (asJson) {
      this.log(JSON.stringify({status, story, checks, fixes}, null, 2))
    } else {
      this.log(`Agentia Doctor: ${status.toUpperCase()}`)
      for (const c of checks) {
        const tag = c.status === 'pass' ? 'PASS' : c.status === 'warn' ? 'WARN' : c.status === 'block' ? 'BLOCK' : 'INFO'
        this.log(`[${tag}] ${c.name}: ${c.detail}`)
        if (c.fix) this.log(`      Fix: ${c.fix}`)
      }
    }

    if (blocked) this.exit(1)
  }
}
