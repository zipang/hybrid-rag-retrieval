---
name: code-review
description: Review submitted code for correctness, readability, adherence to local rules and best practices, architecture, security, and performance. Loads follow-the-rules, typescript-best-practices, api-and-interface-design, software-architecture-principles, and code-simplification as review axes. Use when asked to "review this code", "review the PR", "check src/", "is this ready to merge", or before a commit lands.
---

# Skill: code-review

## Overview

A code review is a **read-only report**. This skill finds problems and ranks them. It does not
rewrite the code, and it does not commit. Ask for a separate task to apply the fixes.

The review runs on axes. Each axis has one owning skill. This skill does not restate their rules. It
loads them, points the reviewer at the files, and merges the findings into one ranked report.

## When to Use

- Before a commit or a pull request lands.
- When someone asks to "review", "check", "audit", or "is this ready".
- After a feature, a refactor, or a rule-file change.
- As a periodic health check over a whole folder, such as `src/`.

**When NOT to use:**

- The change is documentation only. Use the `technical-writing` skill instead.
- You are the author and the change is under ten lines. Self-review is cheaper.
- The user asked for a specific fix, not a review. Do the fix.

## The Axes

| # | Axis | Owning skill | Question it answers |
|---|---|---|---|
| 1 | Local rules | `follow-the-rules` | Does the code obey the `AGENTS.md` chain? |
| 2 | Types | `typescript-best-practices` | Are the types honest, narrow, and free of casts? |
| 3 | Interfaces | `api-and-interface-design` | Are the contracts stable, validated, and hard to misuse? |
| 4 | Architecture | `software-architecture-principles` | Do the layers and the dependencies point the right way? |
| 5 | Simplification | `code-simplification` | Can the same behavior read more clearly? |
| 6 | Security and performance | Below, in this skill | Is the input hostile, and is the cost bounded? |

Load axes 1 to 5 with the skill tool before you start. Run axis 6 from the checklist in this file.

## The Review Pass

### Step 1: Scope the change

Ask what you are reviewing when it is not clear: the diff, one file, or a whole folder.

- **Diff review** — `git diff` and `git status`. Review only the changed lines, but read the
  surrounding function.
- **Folder review** — read every file in scope. State the file count at the top of the report.

### Step 2: Load the rules

Read the `AGENTS.md` and `README.md` chain for every edited file, root first. A rule in a
subdirectory wins over a rule in a parent. Note which chain you applied.

If a rule file that a skill names does not exist, say so in the report. Do not invent the rule.

### Step 3: Run the gates

Run only what the change can affect. Never re-run a command that passed on unchanged files.

```bash
bun run typecheck
bun run lint
bun test
```

Record the exact command and its result in the report. A red gate is a Critical finding and stops
the remaining axes for the failing file.

### Step 4: Walk the axes

One pass per axis. Cite `file:line` for every finding. Skip an axis when the change cannot affect it,
and say that you skipped it.

For each axis:

- Read the skill. Apply its rules as written.
- Report only findings you can point at. No speculation, no "you might want to consider".
- When two axes find the same problem, record one finding and name both axes.

### Step 5: Security and performance

Check these on every review. A hit is Critical when the input is untrusted.

- [ ] Every path from user input, a URL, or a manifest is validated and stays inside its root.
- [ ] Every secret comes from the environment and never reaches a log, a report, or a response body.
- [ ] HTML output is escaped or sanitized before it reaches a page.
- [ ] A response header sets the content type and blocks sniffing.
- [ ] A network or model call has a timeout, a retry limit, and a cost ceiling.
- [ ] An unbounded loop, file, or list has a stated bound.
- [ ] An error path does not leak a stack trace, a token, or a filesystem path to the caller.
- [ ] A destructive write checks the target before it writes.

### Step 6: Rank and report

Order the findings by severity, then by file. Cap the list at the findings a maintainer would act on
this week. A short list of real problems beats a long list of style notes.

## Severity

| Level | Meaning | Effect |
|---|---|---|
| **Critical** | A security hole, a data-loss bug, a broken build, or a failed test | Blocks the merge |
| **Major** | A rule break, a wrong layer, a leaky contract, or a clear correctness risk | Fix before the merge |
| **Minor** | A readability or consistency problem with a known fix | Fix soon |
| **Nit** | Optional polish | Optional |

Use no label for a required fix, and use **FYI** for context with no action.

## Report Format

```markdown
# Code review: <scope>

**Scope:** <diff, file list, or folder with a file count>
**Rules applied:** <the AGENTS.md chain you read>
**Gates:** <command> → <pass or fail>, one line each

**Verdict:** <Approve | Approve with nits | Request changes>

## Blockers
<Critical and Major findings. Empty if none.>

## Findings
| # | Location | Axis | Severity | Problem | Fix |
|---|---|---|---|---|---|

## Architecture
<The layer picture and any change that would move code between layers.>

## Out of scope
<What you did not read, and why.>
```

## Verdict

End with exactly one verdict, and justify it in one sentence.

- **Approve** — the change improves the code health overall, even if it is not perfect.
- **Approve with nits** — no blocker, and the open items are Minor or Nit.
- **Request changes** — a Critical or Major finding stands. Name the concrete downside.

Never approve to be agreeable. A blocker is a blocker.

## Rules for the Reviewer

- **Read before you judge.** Understand the responsibility, the callers, and the edge cases.
- **Cite `file:line` for every finding.** A finding without a location is not a finding.
- **Propose, do not patch.** Give the fix in one sentence. Do not edit the file.
- **Never invent a project rule.** If it is not in an `AGENTS.md`, a `README.md`, or the tool config,
  label it a suggestion, not a violation.
- **Respect the layer rules.** An adapter that holds business logic is a Major finding, even when it
  works, because it blocks the Web UI.
- **Do not report what the linter already enforces** unless the rule is wrong or the file is
  excluded.
- **Prefer high conviction.** Five real findings beat thirty plausible ones.
- **Separate fact from taste.** Put taste in the Nit rows.

## Verification

Before you deliver the report:

- [ ] Every axis was loaded and applied, or marked as skipped with a reason.
- [ ] The `AGENTS.md` chain was read for every reviewed file.
- [ ] The gates ran, and the report records each result.
- [ ] Every finding cites a `file:line`.
- [ ] Every Critical and Major finding has a one-sentence fix.
- [ ] The verdict is one of the three, and it matches the findings.
- [ ] No file was modified during the review.

## See Also

- `follow-the-rules` — axis 1, the local `AGENTS.md` conformance pass.
- `typescript-best-practices` — axis 2, types and narrowing.
- `api-and-interface-design` — axis 3, contracts and error formats.
- `software-architecture-principles` — axis 4, layers and the UI/service split.
- `code-simplification` — axis 5, clarity without a behavior change.
- `technical-writing` — the wording of a `README.md`, an `AGENTS.md`, or a JSDoc block.
