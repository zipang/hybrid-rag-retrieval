# Tickets — Kanban board

This directory holds every ticket in the project. It replaces the old
`roadmap/` directory. One ticket is one unit of planned work. A ticket moves
from `planned/` to `done/` through the status folders below.

The board is the single place to learn what work exists, who owns it, and
whether it is finished.

## Directory structure

```text
tickets/
├── README.md         this board
├── AGENTS.md         agent-only rules for this directory
├── planned/          specified and ready to start
├── in_progress/      owned by one agent or one person, being implemented
├── review/           implemented, peer reviewed, all quality gates green
└── done/             validated, merged, and verified
```

A ticket is one file named `TNNNN-short-kebab-title.md`, for example
`T0008-conversational-retrieval-agent.md`. One file holds the whole ticket: the
requirements, the contract, the acceptance criteria, and the task list with its
checkboxes. The CTO template in `.opencode/agents/cto.md` defines the sections,
in this order:

```text
TNNNN-short-kebab-title.md
├── header            Track, Wave, Status, Depends on, Blocks, References
├── Context & Goal    why the change is needed, and what "done" means
├── Scope Boundary    the files a ticket may create or modify
├── Contract          types, signatures, invariants, and documented APIs
├── TDD Tasks         the ordered checkboxes, tests before implementation
├── Acceptance Criteria  the observable outcomes
└── Glossary          the terms the document uses
```

An `## Implementation Notes` section is appended at the bottom when work starts
or completes.

The older tickets `T0001` to `T0007` use a directory named
`TNNNN-short-kebab-title/` with a `spec.md` and a `plan.md`. That is the legacy
layout. New tickets use the single-file template. Both layouts live in the same
status folders.

The ticket ID is stable. It is never reused and never renumbered. The title in
the file or directory name never changes after creation; only the status folder
changes.

## Statuses

| Status      | Folder         | Meaning                                                                                                                           |
| ----------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Planned     | `planned/`     | The spec exists and is approved. Implementation has not started.                                                                  |
| In progress | `in_progress/` | One owner implements the ticket. The ticket file records the owner and the start date.                                            |
| Review      | `review/`      | Implementation is complete, the independent peer review passed, and every quality gate is green. Waiting for the CEO/PM decision. |
| Done        | `done/`        | Validated by the CEO/PM, merged, and verified.                                                                                    |

A ticket moves forward one folder at a time. A ticket returns to
`in_progress/` when validation or review requests changes.

## Board

### Planned

| ID                                                         | Title                                                          | Depends on   | Blocks  |
| ---------------------------------------------------------- | -------------------------------------------------------------- | ------------ | ------- |
| [T0005](planned/T0005-investigate-copula-verb-syntax-gap/) | Investigate the copula-versus-verb syntax gap                  | nothing      | nothing |
| [T0010](planned/T0010-migrate-callers-and-evaluate.md)     | Migrate the callers, evaluate, and document weighted retrieval | T0009, T0008 | nothing |
| [T0011](planned/T0011-agent-resource-api-server.md)        | Agent resource API server                                      | T0008        | nothing |

### In progress

| ID  | Title                     | Owner | Depends on | Blocks |
| --- | ------------------------- | ----- | ---------- | ------ |
| —   | No ticket is in progress. | —     | —          | —      |

### Review

| ID  | Title                    | Depends on | Blocks |
| --- | ------------------------ | ---------- | ------ |
| —   | No ticket awaits review. | —          | —      |

### Done

| ID                                                    | Title                                                | Delivered                                                                                                                                                                                                                                     |
| ----------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [T0001](done/T0001-hybrid-slogan-retrieval/)          | Hybrid slogan retrieval and chat demo                | Qdrant hybrid index, retrieval API, and streaming chat                                                                                                                                                                                        |
| [T0002](done/T0002-schema-driven-dataset-extraction/) | Schema-driven dataset extraction                     | Record models, dataset configuration, and generic readers                                                                                                                                                                                     |
| [T0003](done/T0003-react-ui-design-system/)           | React UI on an Applied Design System                 | Design System, component kit, and the rebuilt chat surface                                                                                                                                                                                    |
| [T0004](done/T0004-french-syntax-weighted-retrieval/) | French syntax index and weighted retrieval           | UDPipe parser, coarse encoder, `ast` multivector, syntax backfill, and weighted semantic+keyword retrieval with pagination. Closed early; the remainder moved to T0009 and T0010.                                                             |
| [T0006](done/T0006-resumable-dataset-import/)         | Resumable dataset import                             | Dataset-agnostic, non-destructive, resumable dense import                                                                                                                                                                                     |
| [T0007](done/T0007-upgrade-local-qdrant-1-20/)        | Upgrade the development Qdrant to 1.20.0             | Pinned 1.20.0 install, verified in-place upgrade, baseline harness                                                                                                                                                                            |
| [T0008](done/T0008-conversational-retrieval-agent.md) | Conversational retrieval agent on the AI SDK         | Agent as a Markdown resource, two query tools, per-session cache, Markdown answer and source list, and the `POST /api/chat` UI message stream                                                                                                 |
| [T0009](done/T0009-weighted-retrieval-api.md)         | Weighted multi-vector retrieval API and HTTP surface | Uniform weighted query over `syntax`/`semantic`/`keyword`, generic `PayloadFilter`, cursor pagination, and the weighted `GET /api/slogans` surface                                                                                            |
| [T0012](done/T0012-bound-weighted-retrieval.md)       | Bound the weighted retrieval                         | Bounded per-index Query API search with a candidate `limit` (default 50); no full-collection scan                                                                                                                                             |
| [T0013](done/T0013-fix-chat-interface-defects.md)     | Fix the chat interface defects                       | Removed the dead right column, moved the real agent sources there grouped by query, added a "Nouvelle session" button, showed the French turn state in the assistant bubble, and dropped a session's cached searches at the end of every turn |

## Delivery order

The dependency chain below records why the tickets run in this order.

```text
T0002 dataset extraction
  └→ T0001 hybrid retrieval and chat
       └→ T0003 React UI and Design System
            └→ T0004 syntax index and weighted retrieval (closed early)
                 ├→ T0009 weighted multi-vector retrieval API and HTTP surface
                 │    ├→ T0012 bound the weighted retrieval
                 │    └→ T0008 conversational retrieval agent
                 │         ├→ T0011 agent resource API server
                 │         └→ T0010 migrate the callers, evaluate, and document
                 └→ T0005 copula-versus-verb investigation

T0002 dataset extraction
  └→ T0006 resumable dataset import

T0007 Qdrant 1.20.0 upgrade (independent, development runtime only)
```

`T0007` is closed. The development machine runs Qdrant `1.20.0`; the NixOS
server still runs `1.19.1` and needs its own ticket.

`T0004` closed early. Tasks 1 to 13 delivered the parser, the coarse encoder, the
`ast` multivector, the syntax backfill, and the weighted semantic+keyword
retrieval with pagination. The remainder moved to `T0009` (the uniform weighted
multi-vector query and the HTTP surface) and `T0010` (the caller migration, the
evaluation, and the documentation). The chat tool migration is carried by
`T0008`.

`T0009` is closed. It added the `syntax` index to the weighted query, made the
filter generic, and published the weighted HTTP surface. A caller selects any
subset of the three indexes by weight; to query one index, its weight is `1` and
the others are `0`. `T0008` and `T0010` no longer wait for it.

`T0008` is closed. It is the conversational agent. It builds its tools on the
weighted API that `T0009` delivered, so it does not start on the obsolete `topK`
path. It also owns the **agent resource** layer: an agent is a Markdown document
with a YAML frontmatter under `agents/`, loaded at runtime and never hard-coded.
`T0011` serves those resources over HTTP and waits for `T0008`.

`T0005` is independent now. It measures the `coarse` encoder that `T0004`
delivered, so it no longer waits for a retrieval ticket.

`T0012` is closed. The exhaustive scroll that `T0009` delivered times out on a
large collection, so `T0012` replaced it with a bounded per-index Query API
search and a candidate `limit` (default `50`). It blocks `T0010`, which migrates
the callers onto the bounded path.

`T0013` is closed. It cleans the chat interface after the first proof of concept:
it removes the dead right column and its obsolete `topK` request, moves the real
agent sources there grouped by query, adds a "Nouvelle session" button, shows the
French turn state in the assistant bubble, and drops a session's cached searches
at the end of every turn. It depends on no other ticket.

## Ticket rules

- **One owner per ticket.** A ticket in `in_progress/` has one owner. Another
  agent must not edit the same ticket file.
- **Strict scope.** The `Scope Boundary` section lists the files and directories
  that a ticket may change. Shared registration and manifest files are
  append-only.
- **Tests first.** A ticket writes failing tests before production code. The
  `TDD Tasks` list records the order.
- **Gates before review.** Format, lint, typecheck, and tests from `AGENTS.md`
  pass before the ticket enters `review/`.
- **Independent review.** A reviewer sub-agent audits the diff before the
  ticket enters `review/`. The author of the code never reviews it alone.
- **No ticket name in product documentation.** A `README.md` or an `AGENTS.md`
  outside this directory describes a feature by its behavior, not by its
  ticket ID.

## Glossary

- **Acceptance criteria**: the observable outcomes that prove a ticket is
  finished. They describe behavior, not internal implementation.
- **Dependency**: a ticket that must reach `review/` or `done/` before another
  ticket starts.
- **Kanban board**: the set of status folders and their index. It shows where
  each ticket stands.
- **Owner**: the single agent or person that implements a ticket.
- **Planned**: specified and ready to start, with no implementation yet.
- **Scope boundary**: the exact files and directories that a ticket may change.
- **Ticket**: one unit of planned work with an ID, a specification, a plan, and
  acceptance criteria. A new ticket is one Markdown file; the older tickets use
  a directory with a `spec.md` and a `plan.md`.
- **Wave**: a group of tickets that can run in parallel because their scopes do
  not overlap.
