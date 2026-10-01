# Agentia Doctor DX

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node 18+](https://img.shields.io/badge/node-%3E%3D18-blue.svg)](package.json)
[![Agentia 0.122](https://img.shields.io/badge/agentia-0.122.0--alpha.1-blue.svg)](https://developer.copado.com/docs)

**Doctor DX** diagnoses Agentia setup health in one command. Six checks
cover credentials, CRT readiness, skills freshness and project config, and
every failure prints the exact fix command.

No forum diving required. Built for the **Agentia Headless Virtual
Hackathon** as an oclif plugin on top of the public `agentia` CLI.

---

## Table of Contents

- [The Problem](#the-problem)
- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Live Demo Workflow](#live-demo-workflow)
- [Command Reference](#command-reference)
- [Configuration](#configuration)
- [Troubleshooting](#troubleshooting)
- [How It Works](#how-it-works)
- [Security](#security)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Hackathon Fit](#hackathon-fit)
- [License](#license)

---

## The Problem

Getting started stalls on silent misconfiguration. CRT authentication is
separate from CICD and a stored credential does not mean ready. Agent
Skills go stale after CLI upgrades. Local and cloud flows cannot be mixed,
yet the error confuses newcomers. There is no single command that reports
what is broken and exactly how to fix it.

## Features

- **Six health checks** — CICD credentials, CRT readiness with `missing`
  and `issues` details, AI credentials, CLI freshness versus skills
  staleness risk, project config presence, and flow consistency guidance.
- **Exact fix commands** — every failure carries its remedy, such as
  `agentia setup` or `agentia setup skills update --target agents
  --no-prompt`.
- **Dual output** — human checklist with `PASS`, `WARN`, `BLOCK` and `INFO`
  tags, plus `--json` with a `fixes` array for agents.
- **Story scoping** — `--story` adds flow consistency guidance for that
  story.
- **Read only** — never writes credentials, never changes config.
- **Zero private imports** — only shells out to public `agentia` commands.

## Installation

### Prerequisites

- Node 18 or newer.
- Agentia CLI beta: `npm install -g @copado/agentia-cli@beta`

### Install from source

```sh
git clone https://github.com/devkdas/agentia-doctor-dx.git
cd agentia-doctor-dx
npm install
npm run build
agentia plugins link .
```

Re-run `npm run build` after every change to the TypeScript files.

## Quick Start

### 1. Run the checklist

```sh
agentia doctor
```

### 2. Get machine output for agents

```sh
agentia doctor --json
```

### 3. Scope to a story

```sh
agentia doctor --story US-0000024
```

## Live Demo Workflow

Verified live on a real machine:

```text
1. agentia doctor
   -> BLOCKED: auth-cicd block with fix, auth-crt warn with missing
      domain/org/pak, auth-ai pass, cli-skills pass, project-config
      warn, story-flow info
2. Apply the printed fixes (agentia setup for CICD)
3. agentia doctor
   -> ATTENTION: CICD and AI pass, CRT warn remains until trial keys land
4. agentia doctor --json -> fixes array for agent consumption
```

## Command Reference

### `agentia doctor`

| Flag | Description |
|---|---|
| `-s, --story <id>` | Validate flow consistency for this story |
| `-j, --json` | Machine readable JSON with `status`, `checks`, `fixes` |

### `agentia doctor mcp-serve`

Starts an MCP server over stdio exposing read-only suite tools:
`doctor_check`, `gov_check`, `vault_diff`, `graph_blast`,
`release_audit` and `fleet_check`. Point any MCP client at this command
as its server. This is a standalone bridge process, separate from the
host CLI's own MCP loader which only serves shipped tools.

Statuses: `healthy` (all green), `attention` (warnings only), `blocked`
(any block). Exit code `0` unless blocked, which exits `1`.

## Configuration

No files, flags or environment variables. Doctor reads the machine as it
is: keychain credentials via `auth get`, CLI version output for freshness,
and `.agentia/config.json` presence in the working directory.

## Troubleshooting

| Problem | Likely cause | Fix |
|---|---|---|
| `BLOCK auth-cicd` | No CICD credentials | Run `agentia setup` |
| `WARN auth-crt` | PAK, domain or org missing | Complete CRT setup until `ready:true` |
| `WARN cli-skills` | CLI updated without skill refresh | Run the printed skills update command |
| `WARN project-config` | No project defaults | Run `agentia setup` inside the project |
| ESM auto-transpile warning | Linked ESM plugin notice | Benign, compiled output is used |

## How It Works

```text
agentia doctor
  -> agentia auth get --json (cicd set, crt ready/missing/issues, ai set)
  -> agentia --version stderr scan (update available notice)
  -> .agentia/config.json presence in cwd
  -> checklist plus fixes, human or JSON
```

## Security

Read only by design. Nothing is written, no token is printed, and findings
reference fix commands instead of embedding secrets.

## Tech Stack

| Layer | Technology |
|---|---|
| Language | TypeScript on Node 18+ |
| CLI Framework | oclif v4 (ESM, matching the host CLI) |
| Runtime calls | `node:child_process` to public `agentia` commands |

## Architecture

```text
Developer / Agent
       |
agentia doctor [--json] [--story]
       |
Doctor DX (this plugin)
  |- auth reader  -> agentia auth get --json
  |- freshness    -> agentia --version update notice
  |- config probe -> .agentia/config.json in cwd
  |- fix mapper   -> exact command per failure
       |
Checklist / JSON with fixes array
```

## Hackathon Fit

Simplifies setup, configuration, onboarding, command discovery and
troubleshooting. Improves productivity and usability with the easiest demo
in the portfolio: broken environment to green checklist.

## License

MIT License — see [LICENSE](LICENSE) for details.
