# Psters AI Workflow — OpenCode Plugin

Anti-vibe-coding plugin adapted for OpenCode. Enforces disciplined AI-assisted development through structured workflows, specialized agents, and documentation-first practices.

## Core Principles

1. **User control first**
   - The user chooses workflow path and quality gates.
   - Do not silently auto-switch between `/pwf-work`, `/pwf-work-light`, `/pwf-work-tdd`, or `/pwf-work-plan`.

2. **Predictable and repeatable execution**
   - Prefer explicit steps and deterministic outputs.
   - Keep side-effect commands explicit and non-automatic.

3. **Durable documentation**
   - `docs/` is operational memory.
   - Keep docs aligned with implemented state.

## MCP Integration

- **Documentation retrieval**: Context7 MCP for library/framework docs
  - Server: `context7` (npx -y @upstash/context7-mcp)
  - Required flow: `resolve-library-id` → `query-docs`
  - Use whenever implementation depends on external library/framework docs

## Agent Organization

Agents are organized by domain in `.opencode/agents/`:

- **research**: Exploration and information gathering
- **review**: Code review and quality assurance
- **docs**: Documentation generation and maintenance
- **workflow**: Workflow execution and orchestration
- **design**: UI/UX design and component generation

Commands are the user-facing entry points in `.opencode/commands/`.
Skills are reusable procedural playbooks in `.opencode/skills/`.
Agents are specialized subagent instruction files in `.opencode/agents/`.

OpenCode executes review agents as subagents. For example, the Next.js review specialist is defined in `.opencode/agents/review/nextjs-reviewer.md` and is intended to work with the Next.js conventions skill.

## Skills

Reusable skills in `.opencode/skills/`:

**Workflow & Process:**
- Commit orchestration, code review workflows, debugging discipline
- Git worktree management, branch lifecycle, verification gates

**Technology Conventions:**
- Framework-specific patterns (NestJS, Angular, Next.js)
- ORM-specific migration discipline (TypeORM, Prisma) — technology-specific skills
- Deployment workflows (Lambda, containers)
- Next.js reviews and conventions are paired: `.opencode/skills/nextjs-conventions/SKILL.md` and `.opencode/agents/review/nextjs-reviewer.md`

**Quality & Maintenance:**
- Fast validation without full builds
- Documentation maintenance and baseline loading
- Test-driven development (opt-in)

## Multi-agent Orchestration

Parallel subagents are encouraged when tasks are independent.

In OpenCode, the plugin uses the `task` tool plus `@agent` subagent invocation model. Skills are auto-discovered from `.opencode/skills/` and can be referenced by name in workflow instructions.

Guardrails:
- Keep one orchestrator owner.
- Use explicit role boundaries.
- Merge outputs into a single deterministic decision.
- Ask user before broad/high-risk autonomous execution.

**Enforced, not just requested.** Every agent in `.opencode/agents/` declares an
explicit `tools:`/`permission:` block in its frontmatter (see OpenCode's agent
schema: https://opencode.ai/docs/agents). `research/*` and `review/*` agents
are read-only at the permission level (`write: false`, `edit: false`,
`permission.edit: deny`) — they cannot silently modify files no matter what
their prompt says. `docs/*` and most `design/*` agents are write-enabled
because that is their job. A handful of `workflow/*` and `design/*` agents
are read-only by explicit override (e.g. `plan-document-reviewer`,
`spec-flow-analyzer`, `design-implementation-reviewer`) because they analyze
rather than implement. See `scripts/apply-agent-permission-defaults.mjs` for
the policy table, and `tests/agents/agent-permission-frontmatter.test.mjs`
for the regression check that keeps this from drifting.

## Minimal Validation Before Release/Commit

Run:
1. Lint/diagnostic checks for edited files
2. Fast validation: `npm run validate` (or project equivalent)
3. Docs consistency check for updated workflow commands

---

# Operational Guardrails

## Policy hierarchy (who decides what)

1. User explicit instruction in the current chat
2. Project override file (if present): `docs/workflow/operational-overrides.md`
3. This file as default policy

If a project override exists, follow it for project-specific behavior.
If no override exists, use the defaults below.

## Default AWS operations policy (recommended, not forced)

- Run `aws sso login --profile <aws-profile>` before AWS CLI commands when applicable.
- Do not deploy through IAC/CDK unless project-specific rules explicitly allow it.

## Default Lambda deployment policy

- Lambda deployment uses project deployment scripts only.
- Use command `/pwf-aws-lambda-deploy` for guided Lambda deploy flow.

## Completion claims (always required)

- No "done/fixed/passing" claims without fresh verification evidence.
- Include command, exit status, and key output in the completion message.

## Verification evidence format

- `Command:` executed command
- `Result:` exit code/status
- `Evidence:` key output lines
- `Limitation:` partial coverage or constraints (if any)

---

# Commit Messages

- **ALWAYS write commit messages in English**
- **ALWAYS put a [TICKET-XXXX] prefix to the commit message** — ASK the user for the ticket number if not provided.
- Use conventional commit format with emojis when appropriate
- Format: `[TICKET-XXXX] <emoji> <type>(<scope>): <subject>`

## Commit Types

- `🚀 feat`: New feature
- `🐛 fix`: Bug fix
- `📝 docs`: Documentation changes
- `♻️ refactor`: Code refactoring
- `✅ test`: Adding or updating tests
- `⚡ perf`: Performance improvements
- `🔧 chore`: Maintenance tasks
- `🎨 style`: Code style changes (formatting, etc.)
- `🔒 security`: Security fixes
- `🚧 wip`: Work in progress

## Examples

- `[TICKET-1234] 🚀 feat(auth): add JWT authentication`
- `[TICKET-1234] 🐛 fix(api): resolve CORS configuration issue`
- `[TICKET-1234] 📝 docs: update README with deployment instructions`
- `[TICKET-1234] ♻️ refactor(users): improve service structure`
- `[TICKET-1234] ✅ test: add unit tests for auth service`
- `[TICKET-1234] ⚡ perf(database): optimize query performance`

## Guidelines

- Keep subject line under 50 characters when possible
- Use imperative mood ("add" not "added" or "adds")
- First line should be a summary
- Add detailed description in body if needed (separated by blank line)

---

# Build Policy

## TypeScript Validation (Default)

During implementation and development:
- **ALWAYS** run `tsc --noEmit` or `npm run validate` for fast type checking
- **NEVER** run `npm run build` or `next build` automatically
- Fix ALL TypeScript and lint errors before claiming completion

## Full Build (Explicit Only)

Run full build ONLY when:
1. User explicitly requests: "run the build", "build the project", etc.
2. Preparing for deployment
3. Investigating complex build-specific issues that TypeScript check cannot catch

## Anti-patterns (FORBIDDEN)

- Running `npm run build` after every small change
- Running `npm run build` as a default verification step
- Using build as a type-checking substitute

## Correct Workflow

1. After implementing changes → Run `npm run validate` or `tsc --noEmit`
2. Fix all type/lint errors
3. Report evidence: "TypeScript check: 0 errors"
4. Only run build if user explicitly asks or for deployment

## Rationale

- **Speed**: TypeScript check is ~80% faster than full build
- **Feedback loop**: Quick iteration without bundling overhead
- **Same error detection**: Catches same TypeScript and lint issues
- **Resource efficiency**: No unnecessary asset compilation

---

# Context7 — Library Documentation First
This plugin uses OpenCode MCP configuration in `.opencode/opencode.json` and `context7` to resolve framework and library documentation.
**Always** use the Context7 MCP to fetch up-to-date documentation before implementing features or debugging issues that involve libraries or frameworks.

## How to Use

1. **Resolve library ID:** Call `resolve-library-id` (Context7 MCP server) with `libraryName` and `query`.
2. **Fetch docs:** Call `query-docs` with the resolved `libraryId` and a specific `query`.

## Known Library IDs (Example stack)

- `/prisma/prisma` — Prisma ORM
- `/vercel/next.js` — Next.js framework
- `/supabase/supabase` — Supabase client/SDK
- `/anthropic/anthropic-typescript-sdk` — Anthropic/Claude SDK
- `/nestjs/docs.nestjs.com` — NestJS official docs (reference pattern)

For other libraries, resolve the ID first with `resolve-library-id`.

## When to Use

- Before implementing with Prisma, Next.js, Supabase, or any external library
- When checking schema patterns, API routes, or React Server Components
- When debugging framework-specific behavior
- When verifying migration guides or version-specific patterns

---

# No Unsolicited Markdown Files

**NEVER** create `.md` files spontaneously. Only create them when:

1. The user explicitly asks ("create a README", "document this in markdown")
2. A **workflow command** instructs it — these commands create `.md` files as part of their defined output:
   - `/pwf-brainstorm` → `docs/brainstorms/*.md`
   - `/pwf-plan` → `docs/plans/*.md`
   - `/pwf-doc-capture` → `docs/solutions/*.md`
   - `/pwf-doc` → `docs/infrastructure/*.md`, `docs/modules/*.md`, `docs/features/*.md`, `docs/decisions/*.md`
   - `/pwf-doc-foundation` → `docs/infrastructure.md`, `docs/architecture.md`, `docs/integrations.md`, `docs/environments.md`, `docs/glossary.md`
   - `/pwf-doc-runbook` → `docs/runbooks/*.md`, `docs/runbooks/README.md`
   - `/pwf-work` and `/pwf-work-plan` → update existing docs (module, feature, Lambda, pattern docs)
3. Updating an **existing** `.md` file as part of a code task (e.g. updating docs that reference changed code)

**NEVER** create unsolicited summary files, changelog files, or documentation files outside of the above cases. Provide summaries directly in chat.

---

# Docs Scope Boundary

Never mix these two `docs/` scopes:

1. **Plugin docs scope:** Root `docs/` in this workspace documents the plugin itself.
2. **Project docs scope:** `docs/` created/updated by workflow commands in the user's project.

## Required behavior

- For `/pwf-setup`, `/pwf-work`, `/pwf-work-plan`, `/pwf-work-light`, `/pwf-work-tdd`, always operate on the **target project** docs tree.
- Do not treat this repository root `docs/` as the target project docs unless the user explicitly says this repo is the target project.
- If scope is ambiguous, ask which docs scope to use before writing files.

## Canonical project docs paths

Use these paths (no `pwf-` directory prefixes):

- `docs/infrastructure.md`
- `docs/architecture.md`
- `docs/integrations.md`
- `docs/environments.md`
- `docs/glossary.md`
- `docs/runbooks/`
- `docs/runbooks/README.md`
- `docs/brainstorms/`
- `docs/plans/`
- `docs/work-plans/`
- `docs/workflow/operational-overrides.md`
- `docs/solutions/`
- `docs/modules/`
- `docs/features/`
- `docs/lambdas/`
- `docs/decisions/`

---

# Agent Namespace Convention

When referencing plugin agents in prompts, use paths relative to `.opencode/agents/`:

- `agents/research/<agent-name>`
- `agents/review/<agent-name>`
- `agents/docs/<agent-name>`
- `agents/workflow/<agent-name>`
- `agents/design/<agent-name>`

Avoid short names alone when the context is ambiguous.

---

# Command Naming Prefixes

Use explicit technology prefixes for commands that are bound to a specific platform, provider, or framework.

## Rule

- If a command is technology-specific, its name MUST start with that technology prefix.
- If a command is provider-specific, include the provider prefix first.
- Keep framework-agnostic commands generic (do not add unnecessary prefixes).

## Naming format

- Preferred format: `<provider>-<technology>-<action>`
- Example for AWS Lambda deploy: `aws-lambda-deploy`

## Examples

- `aws-lambda-deploy` (AWS-specific Lambda deploy workflow)
- `stripe-webhook-sync` (Stripe-specific operation)
- `angular-component-audit` (Angular-specific operation)

## Anti-examples

- `deploy-lambda` (missing provider/technology prefix)
- `deploy` (too generic for a tech-specific operation)

When creating or renaming commands, always apply this convention and update workflow docs accordingly.
