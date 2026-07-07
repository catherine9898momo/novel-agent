# L3 Agent Engineering Plan

## Goal

Move Novel Agent from a local CLI/tooling MVP toward a deployable L3 agent system: buildable, test-gated, state-driven, observable, and safe to operate behind a service boundary.

## Scope

In scope:

- Make the repository build and test gates explicit.
- Turn the fanfic workflow into a resumable orchestrated flow.
- Add CI as the first deployment readiness gate.
- Define the next engineering backlog for deployment, memory, evaluation, and observability.

Out of scope for the first execution slice:

- Public production hosting.
- User authentication and multi-tenant storage.
- Full long-novel autonomous Writer/Rewriter loop.
- Replacing file artifacts with a database.

## Phase 0: Build And Verification Gate

Acceptance criteria:

- `npm run typecheck` passes.
- `npm test` passes.
- `npm run build` emits TypeScript output without checking generated files into source control.
- CI runs typecheck and tests on pull requests.

Implemented first:

- Fix the current TypeScript gate in the materials Ollama refiner.
- Add package scripts for `typecheck`, `build`, `check`, and `start`.
- Add GitHub Actions CI.

## Phase 1: Resumable Fanfic Orchestrator

Acceptance criteria:

- `continueFanficProject` loads state, executes the next automated command, and stops at human confirmation gates.
- CLI exposes `npm run fanfic -- continue <story_id>`.
- Tests cover initial parse and post-plan draft continuation.
- The orchestrator returns executed commands, next action, final state, and stop reason.

## Phase 2: Deployment Surface

Acceptance criteria:

- Choose one deployment target: container, Node service, or internal-only CLI worker.
- Add a production entrypoint separate from local preview.
- Define runtime env contract and secret requirements.
- Add health check, structured logs, and request/job IDs.
- Make file roots configurable and non-overlapping across environments.

## Phase 3: L3 Agent State And Memory

Acceptance criteria:

- Introduce schema validation for state and artifacts.
- Add state migration/versioning.
- Reconcile state against artifact files before continuing.
- Add structured memory packs: story facts, timeline, character state, relationship state, unresolved hooks, and latest review feedback.

## Phase 4: Evaluation And Quality Gates

Acceptance criteria:

- Add mocked LLM end-to-end tests for the full fanfic workflow.
- Add golden fixtures for planning, drafting, review, and rewrite.
- Convert reviewer verdicts into workflow gates.
- Persist review/audit results as artifacts and queue follow-up actions.

## Phase 5: Production Hardening

Acceptance criteria:

- Add retries, timeout budgets, model cost accounting, and trace logs.
- Add safe write transactions for artifacts.
- Add authorization if any HTTP surface is exposed beyond localhost.
- Add release checklist and rollback notes.
