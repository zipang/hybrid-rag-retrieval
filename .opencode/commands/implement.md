---
description: Implement a change or Ticket in thin vertical slices
---

Invoke the `incremental-implementation` skill for: "$ARGUMENTS"

Before implementing, resolve the Ticket context:

1. If `$ARGUMENTS` contains a Ticket ID (`T\d{4}`), find its directory under
   `tickets/` (any status folder: `planned/`, `in_progress/`, `review/`,
   `done/`). Otherwise, if it names a feature, match it against the Ticket
   titles in `tickets/*/T????-*/spec.md` and `tickets/*/T????-*/plan.md`. If no
   Ticket matches and the change is not ticket-worthy, proceed without one.
2. Load the Ticket's `spec.md` and `plan.md` as context, then implement its
   tasks in order, checking off the plan's task list as tasks complete. Follow
   the rules in `tickets/AGENTS.md` for the status moves.

Build in thin vertical slices — implement one piece, test it, verify it, then expand. Keep the system working at every step.
