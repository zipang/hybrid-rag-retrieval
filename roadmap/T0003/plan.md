# Implementation Plan: [T0003] React UI on an Applied Design System

Ticket: `T0003` — spec: `roadmap/T0003/spec.md`

## Overview

Replace the single-file `demo/index.html` with a React 19 application served by the existing Bun server. The work lands in three layers: a Design System expressed as `DESIGN.md` plus `design-tokens.css`, a component kit whose layout, typography, and controls consume only those tokens, and the chat plus retrieval features rebuilt on the kit. One Bun process serves both the bundled application and the existing `/api/*` routes, so the streaming endpoint stays same-origin.

No front-end test is written. Verification is `bun test` staying green for the backend, `bun run lint` passing, and a manual browser pass over the flows listed in the spec.

## Architecture Decisions

**One process, one origin.** The server imports `src/index.html` and passes it to `Bun.serve` as a route, alongside the two API handlers. Bun's HTML import bundles the referenced `.tsx` and `.css` files with no bundler configuration. `development` is enabled so React Fast Refresh and browser console forwarding work. Verified in `node_modules/bun-types/docs/bundler/fullstack.mdx` and `serve.d.ts:548` for Bun 1.4.2, the pinned version.

**Tokens are a closed set.** `design-system-tokens` fixes the token list. A token exists in `DESIGN.md` front matter and in `design-tokens.css`, or it does not exist. Elevation and border widths come from preset files. The `-muted` and `-active` color variants are derived in `color-variants.css` and are never tokens themselves.

**Layout primitives pass tokens down as CSS custom properties, not as literal values.** `gap="md"` becomes `style={{ "--stack-gap": "var(--space-md)" }}` and the primitive's own stylesheet reads `gap: var(--stack-gap)`. The token reference stays in CSS, no token value is ever duplicated in TypeScript, and the emitted styles stay inspectable in devtools. This is the single documented exception to the no-inline-style rule and it lives only inside `layout/`. Every other component styles itself through a plain CSS file with a kebab-case class matching the component name.

**Path aliases for readability.** `tsconfig.json` gains `paths` for `@components/*` and `@styles/*`. Bun resolves these natively, so no resolver package is needed.

**One stylesheet per component, imported last.** The stylesheet import is the final import in every component file, and the class name repeats the component name in kebab-case. Component states get their own class names.

**Existing working files are copied, not reimplemented.** The layout primitives, typography, and button components already exist and are proven. Copy them verbatim, patch the token names, the import paths, and the custom-property handling, and leave everything else alone. Reimplementing a working primitive is the main way this ticket could regress.

**Token values are never copied.** This applies to `DESIGN.md` and the stylesheets only. The file structure, the token names, and the derivation rules are reusable; every color, font, scale step, and radius is authored fresh. The reference project's palette is arcade-themed and dark, and it does not belong to this project. Copying a value is a defect, not a shortcut.

**Flat, square, and system-fonted.** No radius token is anything but `0`, no elevation token is anything but `none`, and no web font is fetched. Hierarchy is carried by the typographic scale and by spacing, so the scale must be aggressive enough that consecutive steps are never confusable. With no shadow to lean on, surface separation relies on surface tone and a single hairline border, which makes the palette do structural work and keeps it close to neutral.

## Dependency Graph

```text
Task 1  Toolchain (react, tsconfig jsx + paths)
   │
Task 2  Design System files (DESIGN.md, design-tokens.css, presets)
   │
Task 3  Styles + HTML entrypoint + server routes → app renders
   │
Task 4  utils/spacing, utils/tag, layout primitives
   │
   ├── Task 5  base/ Heading + Text
   │       │
   ├── Task 6  ui/ Button + TextField
   │       │
   │   Task 7  app/ MessageBubble + RetrievalHit
   │       │
   │   Task 8  app/ ChatPanel + RetrievalPanel (state, streaming)
   │       │
   │   Task 9  pages/ ChatPage, wire App.tsx, delete demo/
   │       │
   │   Task 10 components docs, root README, glossary
```

Tasks 5 and 6 are independent and can run in parallel. Task 7 depends on both because it composes them.

## Task List

### Phase 1: Foundation

- [ ] **Task 1: Install React and enable JSX with path aliases**
  - Acceptance: `react`, `react-dom`, `@types/react`, `@types/react-dom` are in `package.json`. `tsconfig.json` sets `jsx: "react-jsx"`, adds `"react"` to `types`, and maps `@components/*` and `@styles/*`. `include` drops `demo` and keeps `src`.
  - Verify: `bun install` succeeds. `bunx tsc --noEmit` reports no error on the existing backend files.
  - Files: `package.json`, `bun.lock`, `tsconfig.json`
  - Scope: Small (3 files)

- [ ] **Task 2: Author the Design System files**
  - Acceptance: `DESIGN.md` front matter defines every required token with an inline comment naming its CSS variable. `design-tokens.css` exposes the identical set as `:root` variables. `color-variants.css` derives `-muted` and `-active` for brand and action colors using HSL relative color syntax. Every size is in `rem`. Optional tokens that are omitted carry the documented `var()` fallback.
  - Visual language, fixed by the spec and not open to interpretation:
    - Light neutral background. Surfaces separated by surface tone plus a single hairline border.
    - System font stack for base, display, and mono. No web font is requested and no font file is served, so `fonts.css` declares no `@font-face`.
    - Every `rounded` token resolves to `0`. Every `elevation` token resolves to `none`.
    - One brand accent and four action colours. Action colours appear only in feedback states.
    - The typographic scale carries the hierarchy. Consecutive steps differ by at least 15 percent so a heading never reads as body text.
  - Method: reuse the file structure and the token *names* from the existing `DESIGN.md` and stylesheets; author every *value* from scratch. Copy `reset.css` and `color-variants.css` structurally. Use the flat elevation preset and the 124 border preset, since no shadow and a visible hairline are required.
  - Verify: no token value matches a value from the reference project. Diff the token names in the front matter against the variables in the stylesheet; the sets match. Grep for `@font-face` returns nothing. `bunx biome check DESIGN.md design-tokens.css`
  - Files: `DESIGN.md`, `design-tokens.css`, `color-variants.css`, `src/styles/reset.css`, `src/styles/fonts.css`, `presets/elevation/flat.css`, `presets/borders/124.css`
  - Depends: None
  - Scope: Medium (7 files)

- [ ] **Task 3: Wire the HTML entrypoint into the Bun server routes**
  - Acceptance: `src/index.html` declares `lang="fr"`, holds a `#root` div, and imports `./main.tsx`. `src/main.tsx` imports `design-tokens.css`, `color-variants.css`, `fonts.css`, and `reset.css` in that order, then mounts `<App />` in `StrictMode`, throwing when `#root` is missing. `src/App.tsx` renders a placeholder so the bundle resolves. `src/server/index.ts` imports `index from "../index.html"`, passes it as the `/` route, keeps both API routes, and returns 404 from a `fetch` fallback. `serveStatic` and `DEMO_DIR` are gone. `development` is set from `NODE_ENV`.
  - Verify: `bun run dev` serves the page at `http://localhost:3000/` and `curl http://localhost:3000/api/slogans?q=suc` still answers. Browser console shows the placeholder text.
  - Files: `src/index.html`, `src/main.tsx`, `src/App.tsx`, `src/server/index.ts`
  - Depends: Task 1
  - Scope: Medium (4 files)

### Checkpoint: Foundation

- [ ] `bun test` passes, with the backend tests unmodified
- [ ] `bun run lint` passes
- [ ] `bun run dev` serves the React shell and both API routes on one origin

### Phase 2: The Component Kit

- [ ] **Task 4: Build the layout primitives and their token helpers**
  - Acceptance: `utils/spacing.ts` exports the `SpaceToken` union matching the scale in `design-tokens.css`, the `SpacingProps` and `GapProps` interfaces, and the helper that maps a token to its `var()` reference. `utils/tag.ts` exports the layout tag union. `VStack`, `HStack`, and `Grid` accept `gap`, `padding`, `margin`, alignment, and `as` props. Each ships one `.tsx` and one `.css`, no test file.
  - Method: copy the existing `VStack`, `HStack`, `Grid`, `stack.ts`, `spacing.ts`, and `tag.ts` files verbatim, then patch only what the custom-property decision and the path aliases require. Do not rewrite them from scratch.
  - Note: the copied `.test.tsx` files are not carried over.
  - Verify: `bun run dev` renders three sample stacks driven by token props; changing a token value in `design-tokens.css` moves all three at once. `bun run lint`
  - Files: `src/components/utils/spacing.ts`, `src/components/utils/tag.ts`, `src/components/layout/VStack.tsx` + `.css`, `HStack.tsx` + `.css`, `Grid.tsx` + `.css`, `src/components/layout/utils/stack.ts`
  - Depends: Task 3
  - Scope: Large (10 files)

- [ ] **Task 5: Build the base typography components**
  - Acceptance: `Heading` renders levels `1` through `4` mapped to typography tokens and exposes an `as` prop. `Text` exposes `size`, `tone`, and `as`. Neither hardcodes a color; both read tokens. Each ships one `.tsx` and one `.css`.
  - Method: copy the existing `Heading` and `Text` files, patch the token names to this project's scale, and drop the test files.
  - Verify: `bun run lint`. Visual check that no raw `h1` or `p` appears outside `base/`.
  - Files: `src/components/base/Heading.tsx` + `.css`, `src/components/base/Text.tsx` + `.css`
  - Depends: Task 4
  - Scope: Small (4 files)

- [ ] **Task 6: Build the base form controls**
  - Acceptance: `Button` exposes `variant` and `type`, uses the derived `-active` and `-muted` variants for hover and disabled, and renders a real `button` element. `TextField` is a labelled input forwarding its value and change handler. Each ships one `.tsx` and one `.css`.
  - Method: `Button` is copied from the existing `ui/Button`. `TextField` is copied from `form/TextField`. Patch the token names and drop the test files. Keep both under `ui/` in this project.
  - Verify: `bun run lint`. Manual check that a disabled button and a focused field both read from tokens.
  - Files: `src/components/ui/Button.tsx` + `.css`, `src/components/ui/TextField.tsx` + `.css`
  - Depends: Task 4
  - Scope: Small (4 files)

### Checkpoint: The Kit

- [ ] `bun run lint` passes
- [ ] No color literal exists in any file under `src/components/` — a grep for `#`, `rgb(`, and common named colors returns nothing
- [ ] Every component in the kit has one `.tsx` and one `.css`, and no `.test.tsx`

### Phase 3: The Features

- [ ] **Task 7: Build the message bubble and the retrieval hit**
  - Acceptance: `MessageBubble` takes `role`, `text`, and an optional `isStreaming` flag, and renders the user and assistant variants distinctly from tokens. `RetrievalHit` renders a slogan with its brand and year. Both compose `Text` and the layout primitives rather than raw elements. Each ships one `.tsx` and one `.css`.
  - Verify: `bun run lint`. Manual check that the two roles are visually distinct.
  - Files: `src/components/app/MessageBubble.tsx` + `.css`, `src/components/app/RetrievalHit.tsx` + `.css`
  - Depends: Task 5, Task 6
  - Scope: Small (4 files)

- [ ] **Task 8: Build the chat panel with streaming state**
  - Acceptance: `ChatPanel` owns the message list, the composer, and the in-flight request. It posts to `/api/chat`, reads the response body as a stream, and appends text as it arrives. It pushes each completed turn onto the history it sends back. It renders a French error state when the request fails, and disables the composer while a reply streams. Conversation history lives in this component and nowhere else.
  - Verify: `bun run dev`. Send a question and watch the answer arrive token by token. Stop the network and confirm the error state appears in French.
  - Files: `src/components/app/ChatPanel.tsx` + `.css`
  - Depends: Task 7
  - Scope: Small (2 files)

- [ ] **Task 9: Build the retrieval panel**
  - Acceptance: `RetrievalPanel` fetches `/api/slogans` with the current question, renders each result through `RetrievalHit`, shows a French empty state when there are no results, and clears when the panel is toggled off. It owns no conversation state.
  - Verify: `bun run dev`. Ask a question and confirm slogans appear beside the chat. Ask something with no match and confirm the empty state.
  - Files: `src/components/app/RetrievalPanel.tsx` + `.css`
  - Depends: Task 7
  - Scope: Small (2 files)

- [ ] **Task 10: Compose the page and delete the demo**
  - Acceptance: `ChatPage` lays out the header, `ChatPanel`, and `RetrievalPanel` in an `HStack` that collapses to one column below 48rem, using only layout primitives. `App.tsx` renders `ChatPage`. `demo/` is deleted and nothing references it. The retrieval toggle from the old demo is preserved.
  - Verify: `bun run dev`. Resize below 48rem and confirm the columns stack. `bun test` and `bun run lint` pass. `git status` shows no file referencing `demo`.
  - Files: `src/components/pages/ChatPage.tsx` + `.css`, `src/App.tsx`, `demo/index.html` (deleted)
  - Depends: Task 8, Task 9
  - Scope: Medium (4 files)

### Checkpoint: The Features

- [ ] Chat streams incrementally from `/api/chat`
- [ ] Retrieved slogans render in the side panel, with a French empty state
- [ ] The error state appears when the request fails
- [ ] All user-facing text is French and `lang="fr"` is set
- [ ] No raw `div` or `span` carries a layout class in `pages/` or `app/`
- [ ] `demo/` is gone

### Phase 4: Documentation

- [ ] **Task 11: Document the kit and update the project README**
  - Acceptance: `src/components/README.md` explains the atomic folder rule and how to pick a folder. `src/components/AGENTS.md` states the component rules in full and records that components ship no colocated test and no Radix primitive at this stage. The root `README.md` describes the new front-end structure, and its glossary gains the terms this ticket introduces.
  - Verify: `bunx biome check README.md src/components/README.md src/components/AGENTS.md`
  - Files: `src/components/README.md`, `src/components/AGENTS.md`, `README.md`
  - Depends: Task 10
  - Scope: Small (3 files)

### Checkpoint: Complete

- [ ] Every acceptance criterion in the spec's Success Criteria is met
- [ ] `bun test` passes with the backend tests unmodified
- [ ] `bun run lint` passes
- [ ] The manual browser pass covers streaming, retrieval, empty, and error states
- [ ] Ready for review

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| The HTML import route shape differs from the snippet that motivated this ticket | High — the whole front end fails to boot | Task 3 verifies against the installed type definitions and the bundled Bun docs before any component work starts. If the route shape is wrong, the fix is confined to one file. |
| `jsx: "react-jsx"` and the new `paths` break the existing backend | Medium — unrelated code stops typechecking | Task 1 runs `tsc --noEmit` before Task 3 changes any server file. |
| A color literal creeps into a component stylesheet | Medium — the Design System stops being authoritative | The Checkpoint after Task 6 greps `src/components/` for literals. Component rules land in `src/components/AGENTS.md` in Task 11 so the constraint survives the session. |
| Layout props passed as CSS custom properties conflict with the no-inline-style rule | Low — a reviewable convention question, not a defect | Documented as the narrow exception inside `layout/` only, in both the spec and `src/components/AGENTS.md`. |
| Streaming state turns into tangled component state | Medium — the failure mode that made the old demo throwaway | History lives in `ChatPanel` alone. `RetrievalPanel` holds no conversation state. |
| No front-end tests, so a regression ships unnoticed | Medium — accepted by decision | Verification is the manual pass over four named states. The Decision of Done for this ticket requires that pass before sign-off. |
| A copied primitive gets rewritten instead of patched | Medium — reintroduces the bugs the existing file already fixed | The Method line on each component task says copy, and Task 3 gets the copy-over-redesign principle recorded in Architecture Decisions. |
| A token value is carried over from the reference project | Medium — the UI silently inherits an arcade dark theme it was never designed for | Task 2 authors every value fresh and its Verify step checks that no value matches the reference. The rule is recorded in Architecture Decisions. |
| Hierarchy is too weak to read without shadows or radius | Medium — the flat aesthetic removes the cue a designer would normally rely on | Task 2 fixes a minimum 15 percent step between scale steps and states the rule in `DESIGN.md`. Checked in the manual pass at the smallest text size. |
| Copied component CSS carries a `border-radius` or `box-shadow` from the reference | Medium — a stray rounded corner breaks the flat rule in a place nobody reviews | Task 4 through Task 6 each grep their copied stylesheets for `border-radius` and `box-shadow` and remove both. |
| `DEMO_DIR` removal breaks an unreferenced path | Low | Task 3 greps for `demo` before deleting. |

## Parallelization Opportunities

- Tasks 5 and 6 can run in parallel once Task 4 lands; they touch disjoint folders.
- Task 11 can begin drafting once Task 4 is merged, since it documents conventions rather than the finished components.
- Tasks 8 and 9 are independent of each other and can run in parallel after Task 7.

Tasks 1, 2, 3, 4, 7, and 10 must be sequential.

## Open Questions

- None. Radix, front-end tests, the dark theme, and routing are all excluded by decision recorded in the spec.