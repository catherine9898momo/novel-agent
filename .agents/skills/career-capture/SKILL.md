---
name: career-capture
description: Ask whether a completed Novel Agent commit should be distilled into an evidence-backed Agent engineering interview case, then create, skip, defer, or merge the case using the local Career CLI.
---

# Career Capture

Turn completed Novel Agent engineering work into interview-ready evidence without interrupting or changing the story-generation workflow.

## Workflow

1. Run `npm run career -- status` and parse its JSON output.
2. If there are no eligible pending commits, stop without prompting.
3. Select only the newest eligible pending commit. Do not batch decisions.
4. Run `npm run career -- context --commit <hash>` for that commit.
5. Summarize the commit subject, suggested topics, source and test file counts, and verification evidence. Clearly distinguish verified facts from inferences.
6. Ask exactly one question and offer these four choices: `生成 / 跳过 / 稍后 / 合并`.
7. For `跳过`, run `npm run career -- mark --commit <hash> --status skipped`.
8. For `稍后`, run `npm run career -- mark --commit <hash> --status deferred`.
9. For `合并`, ask which existing case is the target, update that case body and frontmatter, then run `npm run career -- merge --commit <hash> --case <case-id>`.
10. For `生成`, copy `references/case-template.md`, fill every section, write exactly one case to `career-prepare/novel-agent/cases/<case-id>.md` (creating `cases/` when needed), update the matching topic indexes, then run `npm run career -- capture --commit <hash> --case <case-id>`.
11. Mark unsupported outcome claims with `needs_metrics` or `needs_review`; never invent measurements.
12. Never read excluded paths from the commit context and never auto-commit the generated documentation.

未经用户确认，不得创建案例。

## Evidence rules

- Use commit metadata, changed safe paths, tests, and verification commands as evidence.
- Describe behavioral intent as an inference unless a test or artifact demonstrates it.
- Put unknown production impact in `尚未验证`, not `已验证`.
- Keep secrets, credentials, `.env` files, and other excluded paths out of prompts and cases.
- Preserve all previously linked commit hashes when merging a case.

## References

- Case structure: `references/case-template.md`
- Topic names: `references/interview-topic-taxonomy.md`
