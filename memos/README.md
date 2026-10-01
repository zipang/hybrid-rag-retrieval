# Memos

This directory holds short review memos. A memo records a decision, the
evidence for it, and the result of a measurement. A memo is not a spec and not
a plan. A spec says what to build. A plan says the order of the work. A memo
says why a technical choice is correct and what the project measured.

## Content

- One file per topic, for example `qdrant-review.md`.
- The memo states the ticket that it supports.
- The memo states each fact with its source. Use the local documentation
  mirrors under `docs/` for tool behavior.
- The memo shows each benchmark with its method and its numbers.
- The memo ends with a `## Glossary` section. The glossary explains every
  technical term that a less technical reader needs to follow the memo.
  Sort the entries alphabetically.

## Style

- Write in Simplified Technical English.
- Use one name for one thing.
- Keep the numbers. A memo without evidence is an opinion.
