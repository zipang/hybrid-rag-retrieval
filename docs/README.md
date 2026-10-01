# Local documentation

This directory holds local mirrors of official product documentation. Each
mirror is a verbatim copy of one tool at one version. The mirrors let agents
read the exact documentation of the version the project uses, without a web
search.

## Structure

- One directory per tool and version: `docs/<tool> - <version>/`.
- Every mirror has an `index.md` entry point that lists all pages.
- The mirror keeps the upstream file paths (for example
  `docs/Qdrant - 1.19.1/documentation/search/index.md`).

## Source of truth

Each `index.md` records the remote entry point of the mirror. The remote source
is the source of truth. The local copy is a cache.

## Maintenance

The `librarian` agent and the `index-tool-docs` skill create and update the
mirrors. The advertisement in `AGENTS.md` points to the current version.

## Version control

The mirrors are large and regenerable. Git ignores them. Only this `README.md`
and `AGENTS.md` stay in version control.

After a fresh clone, regenerate a mirror with the `librarian` agent and the
`index-tool-docs` skill. Local runs keep the mirror on disk.
