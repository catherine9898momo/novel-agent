# Novel Agent Workspace Rules

## Skill Governance

This project treats skills as opt-in workflow modules, not as authority over the
Novel Agent architecture. Use the project workflow first:

```text
User goal -> story state -> planning -> drafting -> review -> rewrite -> memory/state update
```

Skills must not bypass or replace that pipeline.

### Default Skill Limits

- Simple answer or small code edit: use no skill unless explicitly named.
- Project analysis, architecture planning, or documentation: use at most 1 skill.
- Complex implementation or UI verification: use at most 2 skills.
- More than 2 skills requires a short user-facing reason before loading them.
- External-action skills require explicit user intent or clear task necessity.

### Priority Order

1. User instructions in the current conversation.
2. This repository's `AGENTS.md`.
3. Project docs under `docs/`.
4. Loaded skill instructions.
5. General model defaults.

If a skill conflicts with the Novel Agent workflow or these rules, follow this
file and note the conflict briefly.

### Allowed By Default

Use these when directly relevant:

- `create-plan` for explicit planning requests.
- `diagram` for capability maps, architecture diagrams, or ToDiagram payloads.
- `grill-me` for requested architecture/product stress tests.
- `react-doctor`, `webapp-testing`, `playwright` for frontend validation.
- `gh-fix-ci` only for GitHub Actions CI failures.
- `mcp-builder` only when building or reviewing an MCP server.
- `stop-slop-zh`, `content-research-writer` only for requested prose editing or content synthesis.

### Explicit-Only Skills

Do not auto-trigger these unless the user names them or the task clearly requires
their side effects or external systems:

- Deployment: `vercel-deploy`, `netlify-deploy`, `render-deploy`, `cloudflare-deploy`, `deploy-pipeline`.
- External apps/actions: `connect`, `connect-apps`, Gmail, Notion, Linear.
- Production observability: `sentry`, `sentry-triage`, `datadog-logs`.
- Broad web/social research: `agent-reach`, `firecrawl-lean`.
- Personal productivity or unrelated business workflows: meeting, lead, support, resume, developer-growth skills.

### Traceability

When a skill is used, state the skill name and why it is relevant in one short
sentence. For multi-step work, keep the Novel Agent workflow visible in the
final summary.

## Career Capture

- Before beginning a new implementation task, run `npm run career -- status`. If it returns an eligible pending commit, invoke the project `career-capture` skill and ask the user before implementation continues.
- After a successful commit, invoke the project `career-capture` skill for that commit before declaring the task complete.
- Never generate a career case without explicit user confirmation.
- Do not trigger capture for commits that only change `career-prepare/novel-agent/**` or whose subject starts with `docs(career):`.
- Career capture is a documentation side workflow; it must not bypass or alter the Novel Agent story workflow.
