# Agent rules for the tickets directory

These rules take precedence over the parent `AGENTS.md` for files inside
`tickets/`.

## Status folders

- A ticket lives in exactly one of `planned/`, `in_progress/`, `review/`, or
  `done/`.
- Move a ticket with `git mv` so Git keeps its history.
- Move a ticket forward one folder at a time. Never skip `review/`.
- Move a ticket back to `in_progress/` when review or validation requests a
  change.

## Starting a ticket

1. Move the ticket directory from `planned/` to `in_progress/`.
2. Add `- **Status**: in_progress`, `- **Owner**: ...`, and
   `- **Started**: YYYY-MM-DD` to the header of `spec.md`.
3. Update the tables in `tickets/README.md`.

## Finishing a ticket

1. Check off every completed task in `plan.md`.
2. Append an `## Implementation Notes` section to `plan.md`. Record the
   architectural decisions, the deviations, the review feedback addressed, and
   the exact gate output.
3. Move the ticket to `review/` only after the independent reviewer sub-agent
   approves and every quality gate passes.
4. Move the ticket to `done/` only after the CEO/PM validates it.
5. Update the tables in `tickets/README.md` after every move.

## Writing tickets

- Use `spec.md` for the requirements, the contract, and the acceptance
  criteria.
- Use `plan.md` for the ordered task list. Put one checkbox per task.
- Keep the ticket ID and the directory title stable.
- Do not use a ticket ID to describe a feature in a `README.md` or an
  `AGENTS.md` outside `tickets/`.
- Quote every third-party API in the contract with its documented signature
  and documentation URL. Never read dependency source under `node_modules/`.

## Ownership

- One owner per ticket in `in_progress/`.
- Do not edit a ticket that another agent owns.
- The CTO updates the board. A coding sub-agent does not move its own ticket
  out of `in_progress/`.
