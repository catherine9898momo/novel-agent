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

## Mainline Priority Guardrails

- For multi-step work, keep the `Primary Goal` and `Current Milestone` explicit. A task that does not map directly to the current milestone is supporting or meta work and belongs in the backlog by default.
- Before changing task priority, explicitly tell the user the current goal, the proposed new work, which user-visible capabilities it delays, the expected scope or cost, and the recommended choice. Do not switch until the user confirms that priority change.
- Treat `continue`, `confirm`, and `follow your recommendation` as approval only for the action already described. They do not implicitly authorize pausing or replacing the mainline goal.
- Before implementation, state the task's user-visible contribution, affected core module, and acceptance check. If none can be identified, do not add it to the active plan.
- Without separate user confirmation, supporting and meta work is limited to one commit or 15% of the current milestone effort, whichever comes first.
- If two consecutive tasks or commits do not advance the core Novel Agent workflow, stop before a third and report the drift to the user.
- Do not create recursive meta-work: work to document, plan, or evaluate a supporting mechanism must not generate more such work unless the user explicitly pauses the mainline goal.
- A skill may help execute the current goal but must not broaden a small task into a new project. Follow the repository's scope and skill limits when a skill workflow is disproportionate.
- Milestone updates must report mainline progress, user-visible change, supporting-work share, and any confirmed priority change.
- Data-loss risks, security vulnerabilities, or a fully blocked build may temporarily interrupt the mainline, but report the reason, impact, and condition for returning to it immediately.
