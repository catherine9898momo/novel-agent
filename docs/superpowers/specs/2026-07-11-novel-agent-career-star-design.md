# Novel Agent Career Case STAR Restructure Design

## Goal

Restructure the existing Career Capture interview case around the STAR method so it can be used directly in an Agent engineer interview without creating a duplicate case or overstating results.

## Scope

- Update only `career-prepare/novel-agent/cases/2026-07-11-career-capture-reliability.md`.
- Keep the existing `caseId`, commit evidence, topic links, and `needs_metrics` status.
- Do not create another case or another index entry.
- Do not change the implemented Career Capture workflow.

## Structure

Insert a primary `STAR 面试叙事` section immediately after the title:

1. `Situation` explains why commit-time career capture was needed and why Git and AI interaction have different reliability boundaries.
2. `Task` states the engineering objective and measurable acceptance criteria.
3. `Action` explains decomposition, alternatives, state design, evidence safety, human confirmation, and testing.
4. `Result` separates verified engineering outcomes from unverified production impact.

Keep the existing detailed sections after STAR as an evidence appendix. The 60-second and 3-minute answers should follow the same S-T-A-R order.

## Evidence Rules

- Verified claims may cite the real hook doctor result, focused tests, full suite, and explicit failure scenarios.
- Productivity, interview performance, false-positive rate, and production latency remain unverified.
- No fabricated percentages, time savings, or user-impact metrics.
- Preserve the link between claims and commit `1f2af16bfbbff6360e9b84a1a3998a5ddf862ec2`.

## Acceptance Criteria

- A reader can identify S, T, A, and R without interpreting the technical appendix.
- Result contains separate `已验证` and `待验证` subsections.
- Existing frontmatter remains valid and the career index needs no structural update.
- Career Capture tests, TypeScript checks, and `git diff --check` remain green.
