---
name: index-tool-docs
description: Find, extract, download and index a local copy of a product documentation. Use this skill whenever the task is to create or reindex a documentation for the Librarian.
version: 1.0.0
---

# Index Tool Docs

## Purpose

This skill runs the complete Librarian workflow. It turns an official
product documentation into a local mirror under `/docs/<tool> - <version>/`
that the other agents can read instead of searching the web.

Use this skill when the task is to create a new local documentation or to
reindex an existing one after a version update (e.g. "index the opencode docs", "update the local bun documentation", "reindex a tool documentation").

## Workflow

The workflow has five steps. Do them in order.

### 1. Discover

Establish the exact tool name and version.

1. Find the latest stable version of the tool. Check the official site, the
   GitHub releases page, or the npm registry.
2. If the user did not give an exact version, ask the user to confirm the
   version before you continue.
3. Find the official raw markdown source. Prefer these sources, in this order:
   - An `llms.txt` or `llms-full.txt` index (for example
     `https://bun.com/docs/llms.txt`).
   - The documentation source repository (for example GitHub raw URLs).
   - The official HTML pages (last resort).

### 2. Acquire

Download the complete, unmodified markdown files.

Use the `acquire-llms-docs.ts` script when an `llms.txt` index exists:

```bash
bun run .agents/skills/index-tool-docs/scripts/acquire-llms-docs.ts \
  "https://<host>/docs/llms.txt" \
  "docs/<tool> - <version>"
```

The script downloads every linked `.md` file into the target directory,
preserving the URL path structure. It verifies each file and rejects JSON
error pages, HTML error pages, and files smaller than 100 bytes.

If no `llms.txt` index exists, use `curl` or `wget` on the raw markdown
links from the repository. As a last resort, use `webfetch` on the official
HTML pages and convert them to markdown.

**CRITICAL RULE**: Preserve the original text exactly. Do not truncate, do
not clean up the structure, and do not summarize. The goal is a perfect
local mirror.

### 3. Normalize

Make the local copy readable. Bun documentation carries two upstream
artifacts that break a local mirror:

1. Every page starts with a three-line `Documentation Index` blockquote.
2. Every internal link uses an absolute `/docs/...` path.

Use the `fix-bun-docs` skill to remove both artifacts:

```bash
bun run .agents/skills/fix-bun-docs/scripts/fix-bun-docs.ts "docs/<tool> - <version>"
```

Run the script with `--dry-run` first, check the counts, then run it for
real. For other tools, apply the same normalization manually: remove any
"documentation index" header block and rewrite absolute links into relative
links that resolve inside the mirror.

### 4. Index

Create the `index.md` entry point.

1. Build the chapter list from the normalized files.
2. For each chapter, write a one-sentence description. Use the official
   `llms.txt` description when it exists. Otherwise, read the first lines of
   the file and write a short description from them.
3. Do not self-reference `index.md` in the chapter list.
4. Add the extraction recipe at the end of `index.md`:

```markdown
---
This local documentation for **<tool> - <version>** has been locally
extracted by `The Librarian`, using this remote reference as the source of
truth: <url of the remote entry point>
```

### 5. Advertise

Tell the other agents about the new documentation.

Update the `**LOCAL DOCUMENTATION FOR TOOLS**` section in `AGENTS.md`. Add one
list item per documented tool:

```markdown
- [<ToolName>](./docs/<ToolName>%20-%20<Version>/index.md) <one-sentence tool description>
  Anytime you must generate code or instructions to use these tools in the
  project, you **MUST** refer to this local documentation first. This will
  ensure efficiency, low latency, and conformance to the version of the tool
  actually used inside the project. Preload the `index.md` content of each
  available documentation to keep this in your context for rapid access.
```

Remove any list item for an outdated version of the same tool.

## Updating an existing documentation

When the task is to update a local documentation to a newer version:

1. Use `docs/<tool> - <version>/index.md` from the previous version as a
   template for the new `index.md`.
2. Follow the same recipe to extract the updated documentation.
3. Remove the outdated version directory after the new one is indexed and
   advertised.

## Verification

Before you report the task as done, verify the result:

1. Check that the index page exists: `docs/<tool> - <version>/index.md`.
2. Check that no downloaded file is a JSON error page, an HTML error page,
   or smaller than 100 bytes.
3. Check that the Documentation Index header is gone (Bun only):

```bash
grep -rl "## Documentation Index" "docs/<tool> - <version>" | wc -l
```

4. Check that the advertisement in `AGENTS.md` points to the current version.

## Scripts

- `scripts/acquire-llms-docs.ts` — downloads a mirror from an `llms.txt`
  index and verifies each file. See its header comment for usage.
