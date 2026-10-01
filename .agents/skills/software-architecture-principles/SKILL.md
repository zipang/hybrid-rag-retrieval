---
name: software-architecture-principles
description: Guides layer boundaries, dependency direction, and separation of concerns. Use when adding a feature, splitting a module, deciding where code belongs, or when a service is hard to call without a UI attached. Triggers include "where should this go", "this is hard to test", "separate the UI from the logic", "too many responsibilities", or any module boundary decision.
---

# Software Architecture Principles

## Overview

Architecture answers one question: what depends on what. Good architecture keeps the rules in this
project intact when someone adds a second front end. Every module must stay callable, and testable,
without a user interface attached to it. The Web UI and the CLI must be two adapters over the same
services. A service must never know that a UI exists.

## When to Use

- When adding a feature and deciding which module receives the code.
- When adding a second front end, such as a Web UI next to the CLI.
- When a function cannot be tested without starting a server or a browser.
- When a module grows several unrelated responsibilities.
- When the `api-and-interface-design` skill flags a leaky or duplicated contract.

## Core Principles

### 1. The Dependency Rule

Dependencies point inward. A module may import from the layers below it. A module must never import
from a layer above it.

For this project the layers are:

| Layer | Location | Role | May import |
|---|---|---|---|
| Adapters | `src/cli.ts`, `src/commands/`, `src/server/`, `src/render/` | Parse input, call services, format output | `src/translate/`, `src/extract/`, `src/model/`, `src/shared/` |
| Services | `src/extract/`, `src/translate/`, and the new `src/services/` | Business logic, orchestration, validation | `src/model/`, `src/shared/` |
| Domain | `src/model/` | Data shapes, invariants, pure functions | `src/shared/` only |
| Shared | `src/shared/` | Errors, paths, sanitizing, reporting | nothing internal |

A rule the arrow encodes: a service never imports a file from `src/server/`, `src/render/`, or
`src/commands/`. An adapter may import a service.

```ts
// Wrong: a service depends on the HTTP layer.
import { loadDocumentContext } from "../server/routes.ts";

// Right: a service owns the load, and the HTTP layer calls the service.
import { loadDocumentContext } from "../services/document.ts";
```

### 2. The Port

A service function is a port for an adapter. It takes plain values, and it returns a plain result
object. It never reads the clock, the network, the terminal, or the current directory for itself.

```ts
// Good: the caller supplies the root, and the result is data.
export const buildDocument = async (options: BuildDocumentOptions): Promise<BuildDocumentResult> => { /* ... */ };
```

Every value the function needs must appear in its signature. A function that needs an implicit input
cannot be driven by a Web UI that has a different working directory.

Forbidden inside a service:

- `process.cwd()` as a default parameter value. The caller must pass the root.
- `console.log`, `console.warn`, or any write to a stream.
- `process.exit` or a change to `process.exitCode`.
- Reading `process.env`. The caller reads the value and passes it in.

```ts
// Wrong: the output goes to the terminal, so the function has no return value.
export const runServe = async (options: ServeOptions): Promise<void> => {
  console.log(`Serving ${options.document}`);
};

// Right: the service returns data, and the adapter prints it.
export const startDocumentServer = async (options: StartDocumentServerOptions): Promise<DocumentServer> => { /* ... */ };
```

### 3. One Service, Many Adapters

Adding a front end must not change a service. A new adapter supplies its own input parsing and its
own output formatting, then calls the same service functions the CLI calls.

Test for this rule: write the new adapter, and change no file under `src/model/`, `src/shared/`, or
any service module. If a change is required, a service leaked adapter concerns.

| Concern | Owner |
|---|---|
| Flag names, argument coercion, exit code | `src/cli.ts` |
| URL pattern, status code, header, HTML page | `src/server/` |
| Route, component, fetch call, JSON payload | the future Web UI |
| Validation of a document, a manifest, a unit list | the service |

### 4. Adapters Stay Thin

An adapter converts a request into arguments, calls one service, and converts the result into a
response. An adapter holds no business rule.

The test: if deleting the adapter would delete a rule, the rule is in the wrong layer. Validation of
`--format`, the HTTP status code, and the rendered HTML string are adapter concerns. Whether the
format is supported is a domain concern and belongs in the service.

### 5. The Domain Stays Pure

The files under `src/model/` hold data shapes, invariants, and pure functions. They perform no I/O.
`DocumentManifest`, `DocumentUnit`, and `ExtractedDocument` describe values. They do not read files.

A pure function takes values and returns a value. It is cheap to test because it has no setup.

### 6. I/O Lives at the Edge

`Bun.file`, `Bun.write`, `Bun.serve`, and every `node:fs` import stay in adapters and in a dedicated
I/O helper module. A service calls a repository object that it receives, or an I/O helper in
`src/shared/`, but it must not open a file itself when a repository would do.

When a service needs the file system, inject a small reader or writer interface. A test then passes
a fake that holds strings in memory. `runTranslate` already takes a `deps: { runModel?: ModelRunner }`
parameter. Apply that pattern to every external boundary.

```ts
// Good: the boundary is a parameter, so a test injects a fake.
export type DocumentReader = { readUnitMarkdown: (unitPath: string) => Promise<string> };
```

### 7. One Module, One Responsibility

A module holds one reason to change. Split a module when it serves two audiences, when two unrelated
sets of data change together, or when its name needs the word "and".

`src/commands/build.ts` mixes four responsibilities today: output path resolution, asset copying, HTML
page writing, and PDF section assembly. Each is a separate reason to change. Extract the shared parts
into helpers that a service and the HTTP layer both call.

### 8. Configuration Is a Parameter

Pass configuration through the call chain as an options object. Do not read it from a module-level
constant, a cached promise, or the environment deep inside a call.

A module-level cache is hidden configuration. `defaultTemplatePromise` in
`src/render/template.ts:44` is a process-wide cache of a filesystem read. It makes the result of
`loadTemplateSet()` depend on call order. Prefer an explicit cache owned by the caller.

### 9. Errors Are Part of the Contract

A service signals a failure by throwing a typed error that carries a stable code. An adapter maps
that error to a status code, an exit code, or a message. A service must not choose an exit code,
because the CLI and a Web UI need different answers from the same failure.

Use `AppError` and its subclasses from `src/shared/errors.ts`. Give every error a code that a caller
can branch on, and never match on the message text.

### 10. Duplication Marks a Missing Module

The same code in two files is a missing shared module. Two copies drift, and the third consumer
picks the wrong one.

Three copies of `escapeHtml` exist today: `src/render/html.ts:18`, `src/render/template.ts:29`, and
`src/commands/build.ts:88`. Two copies of `readManifest` exist: `src/server/routes.ts:31` and
`src/commands/delete.ts:54`. Each pair is a boundary that was never drawn. Extract the shared
function, and put it in the lowest layer that both callers may import.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "It is easier to call `loadDocumentContext` from the server module." | A shared service owns the load. Both callers import the service. The direction of the arrow is the design. |
| "The default `repositoryRoot = process.cwd()` saves every caller an argument." | It hides the one value a Web UI and a test must control. Make it required. |
| "The service can log, since the user wants to see the progress." | A service returns progress data. The adapter decides what to show. |
| "This helper is only three lines, so inline it twice." | Two copies drift. Put it in `src/shared/`. Length is not the test. |
| "The domain model needs the file name to build a path." | Return the parts. Let the caller join the path. |
| "A Web UI can import the CLI module, because it already reads the files." | A CLI module holds argument parsing and printing. The Web UI needs neither. |
| "I will move it later, once the second front end exists." | Move it now. The second front end is the reason to move it, and the cost doubles each time you wait. |
| "The cache saves a file read on every request." | Measure first. Pass the cache in from the caller, so the lifetime is visible. |

## Red Flags

- A module under a service folder that imports from `src/server/`, `src/render/`, or `src/commands/`.
- `process.cwd()`, `process.env`, `console.*`, or `process.exit` outside `src/cli.ts` and the adapter
  that owns that output.
- A service that returns `void` and prints the result instead.
- A default parameter value that reads a global.
- Domain types in `src/model/` that carry a file handle, a stream, or a path to open.
- Two files that implement the same helper, such as a validator or an escaper.
- A `deps` parameter on one service and direct calls to the external API on the next one.
- A module whose name needs the word "and", or whose functions serve two unrelated callers.
- A test that must start a server, a browser, or a network stub to exercise a rule.

## Verification

- [ ] Every service function is callable with plain arguments and returns a plain result.
- [ ] No service imports an adapter, and no adapter holds a business rule.
- [ ] A new adapter needs no change to `src/model/`, `src/shared/`, or any service.
- [ ] No `process.cwd()`, `process.env`, `console.*`, or `process.exit` below the adapter layer.
- [ ] Every external boundary, such as a file system or a model API, is an injected interface.
- [ ] Every error path throws an `AppError` with a stable code, and no caller matches on the message.
- [ ] No helper is duplicated across modules. Each copy moved to the lowest shared layer.
- [ ] Every module has one reason to change.
- [ ] `bun test` exercises each service without a server, a browser, or a network.

## See Also

- `code-review` — the review pass that applies this skill as one axis.
- `api-and-interface-design` — the contracts and the error format that a port must follow.
- `follow-the-rules` — the local formatting and documentation rules.
- `code-simplification` — the pass that reduces complexity after the boundaries are correct.
