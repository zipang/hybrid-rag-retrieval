# AGENTS rules for memos/

These rules take precedence over the rules of the parent directories.

- Write a memo after a decision, when the project measured options or compared
  tools.
- State every fact with its source. Cite the installed tool skill under
  `.agents/skills/`, the vendor documentation (its `llms.txt` index, its `.md`
  pages, or the version-matched documentation bundled inside the package such as
  `node_modules/ai/docs/**`), or a live measurement of the running server.
- Keep the exact numbers and the method for every measurement.
- End every memo with a `## Glossary` section. Define each technical term that
  a less technical reader needs to follow the memo. Sort the entries
  alphabetically. Use plain words and short sentences.
- Never read the source of a dependency to support a memo.
- Use the `technical-writing` skill and Simplified Technical English.
- Keep Markdown indentation at 2 spaces.
