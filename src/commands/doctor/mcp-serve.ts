import {Command, Flags} from '@oclif/core'
import {execFileSync} from 'node:child_process'
import {Server} from '@modelcontextprotocol/sdk/server/index.js'
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js'
import {CallToolRequestSchema, ListToolsRequestSchema} from '@modelcontextprotocol/sdk/types.js'

const BRIDGE_VERSION = '0.1.0'
const TOOL_TIMEOUT_MS = 180_000
const OUTPUT_CAP = 12000

interface ToolDef {
  name: string
  description: string
  schema: Record<string, unknown>
  argv: (args: Record<string, unknown>) => string[]
}

function shell(args: string[]): string {
  return execFileSync('agentia', args, {encoding: 'utf8', timeout: TOOL_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'pipe']})
}

function strArg(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null
}

const TOOLS: ToolDef[] = [
  {
    name: 'doctor_check',
    description: 'Run the Agentia setup health checklist. Read only.',
    schema: {
      type: 'object',
      properties: {
        story: {type: 'string', description: 'Optional user story ID for flow guidance.'},
      },
    },
    argv: (a) => {
      const story = strArg(a['story'])
      return story ? ['doctor', '--story', story, '--json'] : ['doctor', '--json']
    },
  },
  {
    name: 'gov_check',
    description: 'Run the pre-promotion policy gate. Read only unless an approval code is presented.',
    schema: {
      type: 'object',
      properties: {
        story: {type: 'string', description: 'User story ID.'},
        env: {type: 'string', description: 'Target environment.'},
        approve_code: {type: 'string', description: 'One time PROD approval code.'},
      },
      required: ['story'],
    },
    argv: (a) => {
      const story = strArg(a['story']) ?? ''
      const args = ['gov', 'check', '--story', story, '--json']
      const env = strArg(a['env'])
      if (env) args.push('--env', env)
      const code = strArg(a['approve_code'])
      if (code) args.push('--approve-code', code)
      return args
    },
  },
  {
    name: 'vault_diff',
    description: 'Compare two Data Vault snapshot files locally. Read only.',
    schema: {
      type: 'object',
      properties: {
        from: {type: 'string', description: 'Older snapshot file path.'},
        to: {type: 'string', description: 'Newer snapshot file path.'},
      },
      required: ['from', 'to'],
    },
    argv: (a) => ['vault', 'diff', '--from', strArg(a['from']) ?? '', '--to', strArg(a['to']) ?? '', '--json'],
  },
  {
    name: 'graph_blast',
    description: 'Map the blast radius of one metadata member. Read only.',
    schema: {
      type: 'object',
      properties: {
        type: {type: 'string', description: 'Metadata type, for example ApexClass.'},
        name: {type: 'string', description: 'Metadata API name.'},
        credential_id: {type: 'string', description: 'Org credential ID.'},
        org_id: {type: 'string', description: 'Org ID.'},
        pipeline_id: {type: 'string', description: 'Pipeline ID.'},
      },
      required: ['type', 'name', 'credential_id', 'org_id', 'pipeline_id'],
    },
    argv: (a) => ['graph', 'blast', '--type', strArg(a['type']) ?? '', '--name', strArg(a['name']) ?? '',
      '--source-credential-id', strArg(a['credential_id']) ?? '', '--source-org-id', strArg(a['org_id']) ?? '',
      '--pipeline-id', strArg(a['pipeline_id']) ?? '', '--json'],
  },
  {
    name: 'release_audit',
    description: 'Aggregate release evidence into a compliance summary. Read only.',
    schema: {
      type: 'object',
      properties: {
        project: {type: 'string', description: 'Copado project ID.'},
        release: {type: 'string', description: 'Release name substring filter.'},
      },
      required: ['project'],
    },
    argv: (a) => {
      const args = ['release', 'audit', '--project', strArg(a['project']) ?? '', '--json']
      const release = strArg(a['release'])
      if (release) args.push('--release', release)
      return args
    },
  },
  {
    name: 'fleet_check',
    description: 'Check readiness across org directories and correlate failures. Read only.',
    schema: {
      type: 'object',
      properties: {
        dirs: {type: 'array', items: {type: 'string'}, description: 'Project directories, one org context each.'},
      },
      required: ['dirs'],
    },
    argv: (a) => {
      const dirs = Array.isArray(a['dirs']) ? (a['dirs'] as unknown[]).filter((d): d is string => typeof d === 'string') : []
      const args = ['fleet', 'check', '--json']
      for (const d of dirs.slice(0, 10)) args.push('--dir', d)
      return args
    },
  },
]

export default class DoctorMcpServe extends Command {
  static description =
    'Start an MCP server exposing read-only suite tools over stdio for MCP clients.'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
  ]

  static flags = {
    json: Flags.boolean({char: 'j', description: 'Unused compatibility flag.', default: false}),
  }

  public async run(): Promise<void> {
    const server = new Server(
      {name: 'agentia-doctor-bridge', version: BRIDGE_VERSION},
      {capabilities: {tools: {}}},
    )

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: TOOLS.map((t) => ({name: t.name, description: t.description, inputSchema: t.schema})),
    }))

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const def = TOOLS.find((t) => t.name === request.params.name)
      if (!def) {
        return {content: [{type: 'text', text: `Unknown tool: ${request.params.name}.`} as const], isError: true};
      }
      const args = (request.params.arguments ?? {}) as Record<string, unknown>
      try {
        const out = shell(def.argv(args))
        const text = out.length > OUTPUT_CAP ? out.slice(0, OUTPUT_CAP) + '\n[truncated]' : out
        return {content: [{type: 'text', text} as const]};
      } catch (error: any) {
        const detail = `Tool ${def.name} failed: ${((error?.message ?? String(error)) as string).split('\n')[0]}`.slice(0, 2000)
        return {content: [{type: 'text', text: detail} as const], isError: true};
      }
    })

    const transport = new StdioServerTransport()
    await server.connect(transport)
    await new Promise(() => undefined)
  }
}
