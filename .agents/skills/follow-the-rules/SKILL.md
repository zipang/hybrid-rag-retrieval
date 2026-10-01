---
name: follow-the-rules
description: Review code against the project's own rules before it lands. Use when asked to "check the rules", "review this change", or before a commit. Discovers the AGENTS.md and README.md chain for the edited files and checks conformance, then runs the matching gates.
---

# Skill: follow-the-rules

Review code against the **project rules** before it lands. This skill does not restate the rules. It
finds them, then points at them.

## Finding the Rules

Read the rule chain for every edited file, from the file's own directory up to the repository root:

1. `AGENTS.md` in the file's directory
2. `README.md` in the same directory
3. The parent directory's `AGENTS.md` and `README.md`
4. Continue up to the root

**A rule in a subdirectory wins over a rule in a parent.** A deeper rule overrides a shallower one.
A file in a directory with no `AGENTS.md` keeps the parent rules unchanged.

The chain in this repository is:

| File | Scope |
|---|---|
| `AGENTS.md` | The whole repository |
| `scripts/AGENTS.md` | `scripts/` only, and it overrides the root |

If a rule file named by another skill does not exist, say so in the report. Never invent the rule.

## The Rules That Apply Here

From the root `AGENTS.md`:

- Read the `README.md` and `AGENTS.md` of the enclosing directories before you edit.
- Use Bun, not Node.js. Use `bun test`, not another runner.
- Prefer a Bun built-in over an npm package.
- Run `bunx biome check --write <files>` on the files you edited.
- Use tabs for every file except Markdown, which uses 2 spaces.
- Declare a full JSDoc block for every function.
- Leave a blank line before `if`, loops, and `return`.
- Prefer `const fn = () => {}`. Do not use the `function` keyword.
- Write documentation in English with the `technical-writing` skill.

## When to Use

- Before a commit or a merge.
- After a feature, a refactor, a rule-file change, or a bug fix.
- When someone asks to "review", "check rules", or "does this follow our conventions".

## Proportionate Verification

Run only what the change can affect:

| Change | Verification |
|---|---|
| Docs only (`*.md`, comments) | Use the `technical-writing` skill, and check the glossary in the root `README.md` |
| Tooling or config | Only the tools that config affects |
| Source code | Full gates: `bun run typecheck`, `bun run lint`, `bun test` |

Never re-run a command that passed on unchanged files.

## The Review Pass

Walk the diff once per axis. Cite `file:line` for every finding.

1. **Rule coverage** — Did the author read the chain for the directory? Do the edits match it?
2. **JSDoc** — Does every function have a full block? Is it written in English and free of
   marketing adjectives? Does it use the project's glossary terms?
3. **Style** — Arrow functions only. Tabs in source, 2 spaces in Markdown. A blank line before each
   control statement.
4. **Tooling** — Bun instead of Node.js. No npm package that a Bun built-in already covers.
5. **Formatting** — Biome ran on the edited files. No manual reformat in the diff.
6. **Scope** — No unrelated change mixed into the diff. No drive-by refactor.
7. **Behavior** — Tests assert observable behavior. The gates are green.

## Findings Format

Label each finding so the author knows what is required:

- *(no prefix)* — required fix before the merge
- **Critical:** blocks the merge, such as a broken build, a failed test, or a security hole
- **Nit:** optional polish
- **FYI:** context only

Lead with correctness. A few high-conviction findings beat a long list.

## Verdict

End with exactly one of:

- **Approve** — the commit may proceed
- **Request changes** — list what must change first

## See Also

- `code-review` — the full pass that runs this skill as axis 1.
- `typescript-best-practices` — the typing rules behind the style pass.
