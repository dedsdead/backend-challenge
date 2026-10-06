# Psters AI Workflow — OpenCode Plugin

Anti-vibe-coding plugin adapted for OpenCode. Enforces disciplined AI-assisted development through structured workflows, specialized agents, and documentation-first practices.

## What This Is

A faithful adaptation of the Psters AI Workflow plugin to work with OpenCode. It provides the same workflow discipline, specialized agents, and documentation-first approach as the Windsurf version.

Officially supported platforms: **Windsurf** and **OpenCode**.

## Installation

Copy the `.opencode/` directory to your project root:

```bash
cp -r .opencode/ /path/to/your/project/
```

Or install via the workflow bridge script:

```bash
node scripts/install-workflow-bridge.mjs --to opencode --project /path/to/your/project
```

## Usage

After placing `.opencode/` in your project, the commands become available via `/pwf-*` in the OpenCode TUI.

### Quick Start

1. Run `/pwf-help` to see all available commands
2. Run `/pwf-brainstorm <idea>` to explore a feature
3. Run `/pwf-plan <description>` to create an implementation plan
4. Run `/pwf-work-plan <plan-path>` to execute phases
5. Run `/pwf-work <description>` for direct implementation
6. Run `/pwf-commit-changes <tickets>` to create structured commits

### Workflow Flow

```
/pwf-brainstorm -> /pwf-plan -> [optional: /pwf-clarify, /pwf-checklist, /pwf-analyze]
-> /pwf-work-plan (or /pwf-work / /pwf-work-light) -> [/pwf-review on demand]
-> /pwf-commit-changes
```

## Command Chooser

| If you need to... | Use |
| --- | --- |
| Get a full command and workflow walkthrough | `/pwf-help` |
| Initialize/repair workflow docs skeleton | `/pwf-setup` |
| Explore idea, scope, architecture options | `/pwf-brainstorm` |
| Turn context into executable tasks/phases | `/pwf-plan` |
| Remove ambiguity before execution | `/pwf-clarify` (optional) |
| Quality-gate requirements by domain | `/pwf-checklist` (optional) |
| Run read-only consistency checks | `/pwf-analyze` (optional) |
| Execute one planned phase | `/pwf-work-plan` |
| Execute direct/unplanned change | `/pwf-work` |
| Execute trivial local change | `/pwf-work-light` |
| Execute tests-first flow | `/pwf-work-tdd` |
| Run heavy multi-agent review | `/pwf-review` |
| Build/refresh project docs baseline | `/pwf-doc-foundation` |
| Create/update operational runbooks | `/pwf-doc-runbook` |
| Refresh stale `docs/solutions/` entries | `/pwf-doc-refresh` |
| Force canonical documentation | `/pwf-doc` |
| Capture reusable learnings | `/pwf-doc-capture` |
| Create structured commits | `/pwf-commit-changes` |
| Deploy Lambda changes | `/pwf-aws-lambda-deploy` |

## Directory Structure

```
.opencode/
├── AGENTS.md              # Main rules and operational guardrails
├── opencode.json          # MCP and base configuration
├── agents/                # 46 specialized subagents
│   ├── research/          # 13 agents: exploration, analysis, research
│   ├── review/            # 15 agents: code review, QA, security
│   ├── docs/              # 10 agents: documentation generation
│   ├── workflow/          # 5 agents: workflow orchestration
│   └── design/            # 3 agents: UI/UX design
├── commands/              # 20 workflow commands (pwf-*)
└── skills/                # 21 reusable skills
```

## Core Principles

1. **User control first** — You choose the workflow path; commands don't auto-switch
2. **Predictable execution** — Explicit steps, deterministic outputs
3. **Documentation-first** — `docs/` is operational memory, kept aligned with implementation

## MCP Integration

The plugin includes Context7 MCP configuration for fetching official library documentation:

```bash
# The MCP server runs via:
npx -y @upstash/context7-mcp
```

Usage flow: `resolve-library-id` → `query-docs`

## Using Agents

Agents can be invoked by @mentioning them in your messages:

```
@repo-research-analyst Map all existing code related to user authentication
@security-sentinel Review this endpoint for security vulnerabilities
@doc-shepherd Update the documentation for the payment module
```

Or use them as subagents within workflows — commands automatically spawn the appropriate agents.

## Anti-Vibe Coding

This plugin enforces:

- **Contextualization**: `/pwf-work` and `/pwf-work-plan` read docs first, never jump to implementation
- **Documentation**: Both commands update docs as part of their mandatory workflow
- **Structure**: Phases, tasks, review loops, and commit conventions keep work traceable

## Adaptation Notes

This is an adaptation from Windsurf to OpenCode:

| Windsurf Feature | OpenCode Equivalent |
| --- | --- |
| `rules/*.mdc` | Combined into `AGENTS.md` |
| `workflows/*.md` | `commands/*.md` with opencode frontmatter |
| `agents/**/*.md` | `agents/**/*.md` with opencode frontmatter |
| `skills/*/SKILL.md` | `skills/*/SKILL.md` with opencode frontmatter |
| `mcp.json` | `opencode.json` MCP config |
| `extensions/` hooks (advisory-only) | `.opencode/plugins/*.js` (real, script-executing hooks) |
| `presets/` | Documented in AGENTS.md, used via `preset:<name>` in input |

**Key differences:**
- OpenCode has a *real*, script-executing plugin/hook API (`.opencode/plugins/`,
  events like `tool.execute.before`, `tool.execute.after`, and `event` for
  session lifecycle — see https://opencode.ai/docs/plugins). This plugin
  ships two: `docs-memory-guard.js` (reminds you to update `docs/` if a
  session edited code but not docs) and `commit-convention-guard.js`
  (reminds/optionally blocks commits missing the `[TICKET-XXXX]` prefix).
  This is strictly more capable than Windsurf's `extensions/` system, which
  can only show an advisory message at a hook point and cannot run code.
- OpenCode uses `@mention` for subagent invocation instead of Windsurf's agent selection UI
- Skills are auto-discovered by OpenCode from `.opencode/skills/`
- Rules are consolidated into a single `AGENTS.md` rather than individual `.mdc` files
- Agents declare an explicit `tools:`/`permission:` policy in their frontmatter,
  so read-only agents (research, review) are enforced by OpenCode itself, not
  just by prompt instructions — see `scripts/apply-agent-permission-defaults.mjs`.
