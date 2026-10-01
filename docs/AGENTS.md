# AGENTS rules for docs/

These rules take precedence over the rules of the parent directories.

## Do not edit mirrored files by hand

- The files under `docs/<tool> - <version>/` are a verbatim copy of the remote
  documentation. Do not edit, reformat, or translate them.
- To change a mirror, use the `librarian` agent with the `index-tool-docs`
  skill. The skill reprocesses the mirror from the remote source of truth.
- Never commit partial downloads or JSON/HTML error pages. The acquire script
  already rejects them; keep that behavior.

## Keep the mirror consistent

- Name each mirror directory `<tool> - <version>` with the exact version that
  the project pins.
- Regenerate `index.md` after you change the page set.
- Update the `LOCAL DOCUMENTATION FOR TOOLS` list in the root `AGENTS.md` when
  you add or update a mirror, and remove the entry of an outdated version.

## Markdown style

- Write Markdown in the docs with 2 spaces for indentation, as in the root
  `README.md` and `AGENTS.md`.
