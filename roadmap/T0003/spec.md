# Spec: [T0003] React UI on an Applied Design System

Ticket: `T0003` — spec: `roadmap/T0003/spec.md`

## Objective

Replace the throwaway `demo/index.html` with a React application that expresses the retrieval stack as a maintained product surface.

The project owner stated the constraint directly: the code must not be throwable, even though the application is a Proof of Concept. It must adopt sane design and architecture principles early enough to evolve into a full production product. This ticket delivers that foundation: a Design System, a component kit built on it, and the existing chat and retrieval features rebuilt on top of that kit.

The current demo fails this bar in three specific ways. It is a single HTML file with inline CSS and vanilla DOM scripting, so no part of it can be reused or tested. It hardcodes every color, size, and radius as a literal, so no visual change is safe. It has no component boundary, so streaming state, retrieval hits, and conversation history are entangled in one event handler.

The Design System follows the _Applied Design System_ approach defined by the `design-system-tokens` skill: a dual-file contract of `DESIGN.md` for agent-readable documentation and `design-tokens.css` for the CSS variables. Component styling uses those variables only. A raw color literal in a component stylesheet is a defect.

The visual language is utilitarian and light. It is a working retrieval tool, not a brand surface, so it stays quiet and legible:

- Every colour is a light neutral except one brand accent and the four action colours, which are used only for feedback states. No gradients, no tinted surfaces, no decorative colour.
- Fonts are the system font stack. No web font is downloaded and no font file is served.
- No border radius anywhere. Every radius token resolves to `0`.
- No shadow. Every elevation token resolves to `none`. Depth comes from spacing, border width, and surface tone alone.
- The typographic scale is the primary carrier of hierarchy. Each step must be distinctly larger than the one below it, so a heading is never ambiguous with body text at a glance. Spacing does the rest of the work.
- Hierarchy is built from space and type, not from decoration. Two components at different levels must be distinguishable without a border, a shadow, or a colour change.

Because there is no shadow and no radius, separation relies on surface tone and a single hairline border. This is deliberate and must stay legible at the smallest text size.

The front end follows a set of conventions that this project applies to itself:

- An HTML entrypoint, `src/index.html`, holds the document shell and imports one module, `src/main.tsx`, which mounts the React root. No build configuration file is needed.
- The stylesheets are imported from `main.tsx`, so the bundler sees every stylesheet as a module dependency.
- Components are typed as `React.FC` with a props interface named `<Component>Props`, and props are destructured in the signature. Every optional prop has a documented default.
- Functions use arrow syntax only. Raw text elements are never used in place of `base/Heading` and `base/Text`.
- Styling is plain CSS. No Tailwind, no CSS-in-JS, and no inline style objects for layout.
- Each component lives in its own file with one colocated stylesheet, and the stylesheet import is the last import.

Bun 1.4.2 already serves HTML imports through `Bun.serve`. The server imports `src/index.html` as a route alongside the existing API routes, so the application and the API stay in one process on one origin. Streaming needs no CORS. Development mode gives React Fast Refresh and browser console forwarding.

This ticket adds no Radix dependency. The current chat surface needs no Radix primitive. A primitive library is introduced later, only on the component that genuinely needs it, and only ever imported through `src/components/ui/` so that feature components never import from the library directly.

Success means the chat and retrieval features work exactly as they do today, rendered through components that a later ticket can extend without rewriting the design system. Front-end correctness is verified by hand in the browser. This ticket writes no front-end test.

## Tech Stack

- Runtime: Bun 1.4.2, the version pinned by `@types/bun` 1.4.2.
- Frontend: React 19 with `react-dom` 19. HTML imports bundle `.tsx` and `.css` without a separate bundler configuration.
- Server: `Bun.serve` with the `routes` option and the `development` option. Verified in `node_modules/bun-types/docs/bundler/fullstack.mdx` and `node_modules/bun-types/serve.d.ts:548`.
- Styling: plain CSS files. No Tailwind, no CSS-in-JS, no CSS modules.
- Design System: `DESIGN.md` plus `design-tokens.css`, per the `design-system-tokens` skill.
- Theme: light, flat, no border radius, system font stack, no web font, no shadow.
- Lint and format: Biome with the project `biome.jsonc`.

New dependencies for this ticket: `react`, `react-dom`, `@types/react`, `@types/react-dom`. No Radix package, no test-runner dependency, and no DOM emulation library.

## Commands

```sh
bun install
bun run dev              # bun --hot --dev src/server/index.ts, serves UI and API
bun test
bun run lint             # biome check .
bunx biome check --write <edited-files>
```

`bun run dev` serves the React application at `/` and the API routes on the same origin. It is the only command needed to work on the project.

## Project Structure

```text
DESIGN.md                       → Design tokens in front matter, plus component usage prose
design-tokens.css               → Every design token exposed as a :root CSS variable
src/
  index.html                    → HTML entrypoint imported by the server; loads main.tsx
  main.tsx                      → React root; imports the four stylesheets
  App.tsx                       → Composes the chat page
  styles/
    fonts.css                   → System font stack assignments from the font tokens; declares no @font-face
    reset.css                   → Base reset consuming the token variables
    color-variants.css          → Derived -muted and -active variants for brand and action colors
presets/
  elevation/flat.css           → All elevation tokens resolve to none
  borders/124.css              → 1px, 2px, and 4px stroke widths
  components/
    README.md                   → Atomic Design folder guide
    AGENTS.md                   → React component rules for agents
    layout/
      VStack.tsx + VStack.css    → Vertical stacking primitive
      HStack.tsx + HStack.css    → Horizontal stacking primitive
      Grid.tsx + Grid.css        → Grid primitive
      utils/stack.ts             → Shared gap and alignment resolution
    base/
      Heading.tsx + Heading.css  → Heading levels driven by typography tokens
      Text.tsx + Text.css        → Body text driven by typography tokens
    ui/
      Button.tsx + Button.css        → The one interactive control this surface needs
      TextField.tsx + TextField.css  → The composer input
    app/
      ChatPanel.tsx + ChatPanel.css      → Message list and composer composition
      MessageBubble.tsx + MessageBubble.css → One chat message
      RetrievalPanel.tsx + RetrievalPanel.css → Retrieved slogans panel
      RetrievalHit.tsx + RetrievalHit.css → One retrieved slogan
    pages/
      ChatPage.tsx + ChatPage.css  → The two-column page composition
  server/
    index.ts                    → Restructured to routes + development + fetch fallback
    api.ts                      → Unchanged slogans handler
    chat.ts                     → Unchanged streaming chat handler
```

Each component keeps a `.tsx` and a `.css` side by side. `demo/` is deleted. Its markup and inline styles are not carried forward.

Folder placement follows the atomic rule. `layout/` and `base/` hold generic pieces, `ui/` holds reusable styled controls, `app/` holds compositions that express a product concept, and `pages/` holds the screen. `MessageBubble` and `RetrievalHit` are product pieces, so they live in `app/` and not in `ui/`. Imports flow downward only: `pages → app → ui/base → layout`.

## Code Style

Tabs, arrow functions only, JSDoc on every function, a blank line before control statements and before `return`. Biome formatting via `bunx biome check --write`.

Components use `React.FC` with destructured props, one props interface named `<Component>Props`, and a documented default for every optional prop.

```tsx
import type { FC } from "react";

import { HStack } from "../layout/HStack";
import { Text } from "../base/Text";
import type { Slogan } from "../../models/slogan";
import style from "./RetrievalHit.css";

export interface RetrievalHitProps {
	/** The retrieved slogan shown in the panel. */
	slogan: Slogan;
}

/** Renders one retrieved slogan with its brand and year. */
export const RetrievalHit: FC<RetrievalHitProps> = ({ slogan }) => (
	<HStack gap="sm" alignItems="baseline">
		<Text size="sm" tone="muted">
			{slogan.marque} ({slogan.annee})
		</Text>
		<Text size="sm">{slogan.slogan}</Text>
	</HStack>
)
```

Layout primitives take token props, never raw CSS. A raw `div` or `span` used for layout in `pages/` or `app/` is forbidden. `src/components/AGENTS.md` states these component rules in full and takes precedence over the root `AGENTS.md` inside that directory.

Two narrow exceptions allow a raw element. A layout primitive renders its own element internally through an `as` prop, and a `ui/` component may render a semantic element such as `article`, `section`, or `button` when no layout primitive expresses it. Either case carries a one-line comment explaining why.

Typography goes through `base/Heading` and `base/Text`. Raw `h1` through `h6` and raw `p` tags are not used in `pages/` or `app/`.

Stylesheets reference tokens only:

```css
.retrieval-panel {
	background: var(--color-surface-card);
	border: var(--border-sm) solid var(--color-surface-alt);
	border-radius: var(--rounded-md);
	padding: var(--space-md);
	gap: var(--space-sm);
}
```

No color, spacing, radius, or border value in a component stylesheet may be a literal. The full token list is fixed by the `design-system-tokens` skill. Undocumented tokens are forbidden.

## Testing Strategy

This ticket writes no test for the front-end. UI component tests are out of scope by decision, so no component ships a `.test.tsx` file and no DOM emulation or component-testing dependency is added.

Front-end correctness is verified by running `bun run dev` and using the page. The manual checks are listed in Success Criteria and must be performed before the ticket is called done.

The backend keeps its existing coverage:

- Run tests with `bun test`.
- Keep `src/lib/*.test.ts`, `src/server/api.test.ts`, and `src/server/chat.test.ts` green. This ticket does not change their subjects.
- Add no test-runner dependency and no `bunfig.toml` preload.

A future ticket may add component tests. The colocated `Foo.test.tsx` convention is then adopted at that point, together with the DOM environment it requires. Until then, `src/components/AGENTS.md` records that components ship without colocated tests, so a later agent does not assume a missing test file is an oversight.

## Boundaries

- **Always:** Bootstrap the front end from an `src/index.html` entrypoint that imports `src/main.tsx`, with no build configuration file. Type components as `React.FC` with a destructured props interface. Use one file and one stylesheet per component. Keep `DESIGN.md` and `design-tokens.css` identical in value. Reference tokens through `var()` in every component stylesheet. Use `layout/VStack`, `layout/HStack`, and `layout/Grid` for all layout in `pages/` and `app/`. Write user-facing strings in French. Keep the API handlers and the retrieval logic unchanged.
- **Ask first:** Add any Radix package or any other UI dependency. Add a web font, a border radius, or a shadow. Add front-end tests, a DOM emulation library, or a `bunfig.toml` preload. Introduce routing. Change the `/api/chat` or `/api/slogans` contract, the streaming format, or the retrieval behavior. Add a dark theme. Change the TypeScript rules or the project lint setup.
- **Never:** Write a raw color literal, spacing value, radius, or border value in a component stylesheet. Use a border radius, a shadow, a gradient, or a web font anywhere. Use an action colour for decoration. Use Tailwind, CSS-in-JS, or inline style objects for layout. Use a raw `div` or `span` for layout in `pages/` or `app/`. Add an undocumented design token. Run a second server process for the frontend, or reintroduce cross-origin API calls. Commit `.env` files or credentials.

## Success Criteria

- `bun run dev` serves the React application at `/` from the same process and origin as `/api/chat` and `/api/slogans`.
- Editing a component stylesheet reflects in the browser without a manual reload, through Bun's development mode.
- Browser console output appears in the terminal, through `development.console`.
- `DESIGN.md` defines every required token in its front matter, and `design-tokens.css` exposes the same tokens as CSS variables with identical values.
- `design-tokens.css` imports its elevation and border presets from `presets/` rather than redefining them.
- `color-variants.css` derives the `-muted` and `-active` variants for brand and action colors, and they appear in no token table.
- Every radius token resolves to `0` and every elevation token resolves to `none`.
- The font stack is the system font stack. No web font is requested and no font file is served.
- The background is a light neutral. Surfaces are separated by surface tone and a single hairline border, not by shadow.
- Consecutive steps of the typographic scale are far enough apart that a heading is distinguishable from body text at a glance. No two adjacent steps differ by less than roughly 15 percent.
- Every action colour is used only for feedback, never for decoration. A brand accent appears on the primary action and the focus ring, and nowhere else.
- No component stylesheet contains a color literal. A review grep for hex, `rgb`, and named colors under `src/components/` returns nothing.
- All layout in `pages/` and `app/` comes from `VStack`, `HStack`, or `Grid`. No raw `div` or `span` carries a layout class there.
- The chat streams tokens incrementally from `/api/chat` and shows a visible error state when the request fails.
- Retrieved slogans from `/api/slogans` render in the side panel, and the panel shows an empty state when there are no results.
- User-facing text is French. The `<html>` element declares `lang="fr"`.
- `demo/` is deleted and no file references it.
- `src/server/api.test.ts` and `src/server/chat.test.ts` still pass, unmodified, and `bun test` passes.
- `bun run lint` passes.
- `src/components/README.md` and `src/components/AGENTS.md` document the kit for humans and for agents. They state the atomic folder guide and the component rules from this spec in full, and they record that components ship no colocated test and no Radix primitive at this stage.
- The root `README.md` describes the new front-end structure and its glossary gains the terms this ticket introduces.

## Open Questions

- None. Radix stays out of this ticket by decision, front-end tests stay out by decision, the dark theme stays out by decision, and routing stays out by decision.

## Glossary

- **Applied Design System**: The project approach where a fixed, documented token set lives in two files that must stay identical, and components consume those tokens instead of literals.
- **Atomic Design**: The folder rule that places small generic components low and product components high, so imports flow in one direction only.
- **Color literal**: A raw color value such as a hex code or a named color written in a stylesheet instead of referenced through a token.
- **Design token**: A named value such as a color or a spacing step, defined once and consumed everywhere as a CSS variable.
- **Elevation preset**: A stylesheet that sets the shadow values for every elevation token, imported rather than redefined.
- **HTML import**: A Bun feature that bundles a `.html` file together with the `.tsx` and `.css` files it references.
- **HStack**: A layout primitive that arranges its children in a row with token-driven gap and alignment.
- **React Fast Refresh**: A development feature that swaps component code in the browser without losing page state.
- **Route**: An entry in the `routes` option of `Bun.serve` that maps a URL path to a handler or to an imported HTML file.
- **Hairline border**: The thinnest border, used here to separate surfaces because there is no shadow.
- **System font stack**: The fonts already installed on the reader's device, listed in CSS so the browser picks the best available one. No font file is downloaded.
- **Token prop**: A component property whose value names a design token, so spacing and alignment flow from the Design System rather than from CSS.
- **Utilitarian**: Plain and functional, with no decoration that does not help the reader do the job.
- **VStack**: A layout primitive that arranges its children in a column with token-driven gap and alignment.