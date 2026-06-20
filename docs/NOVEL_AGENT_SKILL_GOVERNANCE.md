# Novel Agent Skill Governance

## Purpose

The Novel Agent project now has many installed Codex skills. The goal of this
policy is to keep capability coverage without turning the workflow into
prompt-driven routing noise.

Core principle:

```text
Skills extend the workflow; they do not choose or replace the workflow.
```

## Risks Being Controlled

1. Routing ambiguity: multiple skills appear relevant to the same request.
2. Context pollution: irrelevant `SKILL.md` content enters the model context.
3. Workflow override: a skill's internal process bypasses Novel Agent's pipeline.
4. Side effects: deployment, email, app, or external research skills act too early.
5. Debug opacity: outputs become hard to explain because hidden skill prompts changed behavior.

## Novel Agent Primary Workflow

All skills are subordinate to this chain:

```text
User input
  -> world/story state
  -> outline and volume plan
  -> chapter plan
  -> drafting
  -> continuity/style/quality review
  -> rewrite
  -> memory and state persistence
```

For implementation work, the engineering chain is:

```text
Read repo
  -> identify current behavior
  -> make scoped change
  -> verify
  -> summarize
```

## Invocation Limits

| Task Type | Default Skill Limit | Rule |
|---|---:|---|
| Simple Q&A | 0 | Answer directly unless a skill is explicitly named. |
| Small code/doc edit | 0-1 | Use local repo context first. |
| Project audit or planning | 1 | Prefer one planning/diagram skill only. |
| Architecture + diagram | 1-2 | `diagram` may pair with one planning/review skill. |
| Frontend implementation verification | 1-2 | Use `react-doctor` or `webapp-testing` only after code exists. |
| CI/debug task | 1 | Use the specific CI/debug skill only. |
| External research | 1 | Use one research skill; cite sources and avoid mixing crawlers. |
| Deployment/app actions | 1 | Explicit user request required. |

Hard cap: do not load more than 2 skills in a normal turn. If 3 or more are
needed, announce the reason before loading them.

## Skill Layers

### Layer 0: System Skills

Status: always available, but still not automatically loaded.

- `skill-installer`: install skills only when the user asks.
- `skill-creator`: create or update a skill only when the user asks.
- `imagegen`: generate/edit bitmap images only when the task is visual.
- `openai-docs`: OpenAI product/API docs only.
- `plugin-creator`: plugin scaffolding only.

### Layer 1: Novel Agent Core Workflow

Use when the task directly supports Novel Agent architecture, planning, or
project understanding.

- `create-plan`: explicit task planning.
- `diagram`: capability maps, workflow diagrams, ToDiagram artifacts.
- `grill-me`: explicit stress testing or devil's-advocate review.
- `content-research-writer`: research-backed writing or structured article/report writing.
- `stop-slop-zh`: Chinese prose cleanup after drafting.

Default: allowed by task match.

### Layer 2: Engineering Workflow

Use only for repo/code tasks where the skill matches the concrete operation.

- `react-doctor`: React diagnostics and remediation.
- `webapp-testing`, `playwright`, `playwright-interactive`: browser/UI verification.
- `gh-fix-ci`, `pr-review-ci-fix`, `gh-address-comments`: GitHub PR/CI work.
- `mcp-builder`: MCP server design/build/review.
- `codebase-migrate`: large migrations only.
- `systematic-debugging`, `test-driven-development`, `verification-before-completion`: use selectively for complex engineering loops.

Default: one engineering skill per turn unless verification clearly requires a
browser/testing pair.

### Layer 3: Visual and Presentation Output

Use only when the user asks for visual artifacts, diagrams, cards, UI polish, or
presentation-oriented output.

- `diagram`
- `frontend-design`
- `figma-*`
- `taste-skill`
- `guizang-social-card-skill`
- `canvas-design`
- `theme-factory`
- `brand-guidelines`
- `imagegen`

Default: explicit or strongly implied visual task required.

### Layer 4: External Systems and Side Effects

These are explicit-only. They can read from or act on external systems and must
not be triggered just because their domain is mentioned.

- Deploy: `vercel-deploy`, `netlify-deploy`, `render-deploy`, `cloudflare-deploy`, `deploy-pipeline`.
- Apps/actions: `connect`, `connect-apps`, Gmail, Notion, Linear.
- Observability: `sentry`, `sentry-triage`, `datadog-logs`.
- Web/social research: `agent-reach`, `firecrawl-lean`.

Default: blocked unless the user asks for that action or the task cannot be
completed without it.

### Layer 5: Personal Productivity / Non-Novel Adjacent

Keep these out of Novel Agent work unless explicitly requested.

- `lead-research-assistant`
- `support-ticket-triage`
- `tailored-resume-generator`
- `meeting-notes-and-actions`
- `meeting-insights-analyzer`
- `developer-growth-analysis`
- `file-organizer`
- `changelog-generator`

Default: off.

### Layer 6: Discovery and Experimental Skills

Use only during skill management sessions, not during normal Novel Agent
implementation.

- `find-skills`
- `suggest-local-skills`
- `writing-skills`
- `using-superpowers`
- other newly installed or unvalidated skills

Default: off except when the user asks to find, install, rank, or govern skills.

## Routing Rules

1. Start with the user's intent, not the skill list.
2. Prefer no skill for normal code reading, small edits, and direct answers.
3. Choose the narrowest skill that solves the task.
4. Do not combine overlapping skills unless each has a different phase.
5. Never let a skill override the Novel Agent state/planning/writing/review loop.
6. For side-effect skills, confirm explicit intent and summarize the action.
7. If a skill's instructions conflict with repo instructions, follow repo instructions.
8. Record skill usage in the final summary when it affects the output.

## Recommended Skill Sets By Scenario

| Scenario | Recommended Skill(s) | Avoid |
|---|---|---|
| Novel Agent capability map | `diagram` | unrelated frontend/social card skills |
| Architecture review | `grill-me` or no skill | loading both many review skills |
| Action plan doc | `create-plan` if explicitly requested | deploy/app skills |
| UI demo verification | `react-doctor` then `webapp-testing` | visual design skills unless styling is requested |
| Chinese copy polishing | `stop-slop-zh` | broad rewriting skills that change meaning |
| Public web research | `agent-reach` or `firecrawl-lean`, not both by default | multiple crawlers |
| CI failure | `gh-fix-ci` | generic debugging skills first |
| Skill inventory | `suggest-local-skills`, `find-skills` | normal coding skills |

## Acceptance Criteria For Skill Use

A skill invocation is acceptable only if all are true:

1. The user intent or task phase maps to the skill's narrow purpose.
2. The expected output improves because of the skill.
3. The skill does not create side effects without explicit permission.
4. The skill does not bypass Novel Agent's state/workflow model.
5. The final answer can explain why the skill was used.

## What Not To Do

- Do not load skills speculatively.
- Do not use skill discovery during normal implementation.
- Do not use deployment or external app skills as "helpful defaults".
- Do not mix several writing/style skills on one prose output unless the user asks.
- Do not treat visual-output skills as architecture-analysis tools.
- Do not let `agent-reach` or `firecrawl-lean` replace local repo inspection.
- Do not use `superpowers` as a blanket wrapper around every task.

## Current Practical Default For Novel Agent

For most Novel Agent work, use this minimal set:

```text
No skill by default
diagram       -> capability maps / workflow diagrams
create-plan   -> explicit planning docs
grill-me      -> requested critique
react-doctor  -> React-specific diagnostics
webapp-testing/playwright -> UI verification
stop-slop-zh  -> Chinese prose cleanup
```

Everything else is opt-in.
