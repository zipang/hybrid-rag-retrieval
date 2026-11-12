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

Each ticket is a directory named `TNNNN-short-kebab-title`, for example
`T0004-french-syntax-weighted-retrieval`. The directory holds the ticket
artifacts:

```text
TNNNN-short-kebab-title/
├── spec.md           the requirements, the contract, and the acceptance criteria
├── plan.md           the task list and its checkboxes
├── README.md         optional user guide for the delivered feature
└── *.md              optional decision records and evaluation reports
```

The ticket ID is stable. It is never reused and never renumbered. The title in
the directory name never changes after creation; only the status folder
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

| ID                                                         | Title                                         | Depends on | Blocks  |
| ---------------------------------------------------------- | --------------------------------------------- | ---------- | ------- |
| [T0005](planned/T0005-investigate-copula-verb-syntax-gap/) | Investigate the copula-versus-verb syntax gap | T0004      | nothing |

### In progress

| ID                                                           | Title                                                | Owner                               | Depends on          | Blocks  |
| ------------------------------------------------------------ | ---------------------------------------------------- | ----------------------------------- | ------------------- | ------- |
| [T0004](in_progress/T0004-french-syntax-weighted-retrieval/) | French syntax index and weighted threshold retrieval | coding sub-agent, supervised by CTO | T0001, T0002, T0003 | T0005   |
| [T0007](in_progress/T0007-upgrade-local-qdrant-1-20/)        | Upgrade the development Qdrant to 1.20.0             | coding sub-agent, supervised by CTO | nothing             | nothing |

### Review

| ID  | Title                    | Depends on | Blocks |
| --- | ------------------------ | ---------- | ------ |
| —   | No ticket awaits review. | —          | —      |

### Done

| ID                                                    | Title                                 | Delivered                                                  |
| ----------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------- |
| [T0001](done/T0001-hybrid-slogan-retrieval/)          | Hybrid slogan retrieval and chat demo | Qdrant hybrid index, retrieval API, and streaming chat     |
| [T0002](done/T0002-schema-driven-dataset-extraction/) | Schema-driven dataset extraction      | Record models, dataset configuration, and generic readers  |
| [T0003](done/T0003-react-ui-design-system/)           | React UI on an Applied Design System  | Design System, component kit, and the rebuilt chat surface |
| [T0006](done/T0006-resumable-dataset-import/)         | Resumable dataset import              | Dataset-agnostic, non-destructive, resumable dense import  |

## Delivery order

The dependency chain below records why the tickets ran in this order.

```text
T0002 dataset extraction
  └→ T0001 hybrid retrieval and chat
       └→ T0003 React UI and Design System
            └→ T0004 syntax index and weighted retrieval
                 └→ T0005 copula-versus-verb investigation

T0002 dataset extraction
  └→ T0006 resumable dataset import

T0007 Qdrant 1.20.0 upgrade (independent, development runtime only)
```

`T0004` is not finished. Tasks 12 to 17b are open: `ast` vector storage,
syntax backfill, syntax-weighted retrieval, the weighted API, the caller
migration, and the release documentation. `T0005` must not start before
`T0004` closes, because it measures the `coarse` encoder that `T0004`
delivers.

## Ticket rules

- **One owner per ticket.** A ticket in `in_progress/` has one owner. Another
  agent must not edit the same ticket directory.
- **Strict scope.** `spec.md` lists the files and directories that a ticket
  may change. Shared registration and manifest files are append-only.
- **Tests first.** A ticket writes failing tests before production code. The
  `plan.md` task list records the order.
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
  acceptance criteria.
- **Wave**: a group of tickets that can run in parallel because their scopes do
  not overlap.
