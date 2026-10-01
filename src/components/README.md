# Component Kit

Every component under `src/components` follows one rule set.

## Folders

Folders follow Atomic Design: generic pieces live low, product pieces high.

| Folder | Holds | Import direction |
|---|---|---|
| `layout/` | `VStack`, `HStack`, `Grid` — structure only | lowest |
| `base/` | `Heading`, `Text` — typography only | from `layout` up |
| `ui/` | `Panel`, `Button`, `TextField` — reusable controls | from `base` up |
| `app/` | `ChatPanel`, `RetrievalPanel`, `MessageBubble`, `RetrievalHit` | from `ui` up |
| `pages/` | `ChatPage` — the screen | top |

Imports flow downward only: `pages → app → ui → base → layout`.

## The three layout primitives

Use these for every bit of structure. They are the only way to stack, space,
group, or align things.

```tsx
<VStack gap="md" padding="lg" as="section">…</VStack>
<HStack gap="sm" justify="between" align="center" wrap>…</HStack>
<Grid columns="split" gap="lg">…</Grid>
```

- `gap` and `padding` take a token: `none`, `xs`, `sm`, `md`, `base`, `lg`, `xl`, `xxl`.
- `Grid` takes `1`, `2`, `3`, or `"split"`. Every multi-column grid collapses to one column below 48rem, so never write a breakpoint yourself.
- `as` changes the rendered element. Use the semantic one: `header`, `footer`, `section`, `aside`, `main`, `form`.

## Rules

- **No raw layout elements.** Never write `<div>`, `<ul>`, `<ol>`, or `<li>` to arrange things. Use `VStack`, `HStack`, or `Grid`.
- **No raw text tags.** Never write `<h1>`–`<h6>` or `<p>`. Use `Heading` and `Text`.
- **An id, not a class, for a region's own rules.** Give each region a unique id (`#chat-panel`, `#retrieval-panel`, `#page`) and write its specific rules in the owning stylesheet, scoped under that id. A class is for shared, reusable appearance; an id is for one element on the page.
- **No overriding a primitive's basics.** Do not pass `flex`, `display`, or `grid-template-columns` through `style` to fight a prop. If the layout is wrong, fix the component.
- **No colour literals.** Every value is `var(--token)`. A hex code in a stylesheet is a defect.
- **No radius, no shadow.** The Design System is flat and square.
- **One file, one component, one stylesheet.** The stylesheet import comes last.
- **No tests in this directory yet.** T0003 excluded them; the backend keeps its coverage.

## Components are small on purpose

Compose from the kit instead of building a new one. A panel is `Panel`, not a
`div` with a border rule. A list row is `RetrievalHit`, not an `li`.