# React Component Rules — `src/components/`

These rules apply to every React component in this directory.
Read [`../AGENTS.md`](../AGENTS.md) for the TypeScript rules; they are not
repeated here.

Read [`README.md`](./README.md) for the folder guide before adding a file.

## 1. Use the layout primitives for all structure

`VStack`, `HStack`, and `Grid` are the only way to stack, space, group, or
align. A raw `<div>`, `<ul>`, `<ol>`, or `<li>` used for layout is forbidden:

```tsx
// ❌ FORBIDDEN
<div className="results" style={{ display: "flex", gap: "16px" }}>
  <span>{hit.slogan}</span>
</div>

// ✅ REQUIRED
<VStack gap="sm">
  <Text size="sm">{hit.slogan}</Text>
</VStack>
```

The single exception is a semantic element the kit cannot render and that
carries its own meaning: `<input>`, `<button>`, `<form>` behaviour, or a
`<label>`. Add a one-line comment when you use one.

`MarkdownText` is one documented, narrow exception. It is the **only** component
that may render a raw `<ul>`, `<ol>`, `<li>`, `<table>`, `<thead>`, `<tbody>`,
`<tr>`, `<th>`, or `<td>`, because the kit has no primitive for a list or a
table. It also keeps the inline semantic elements `<strong>`, `<em>`, `<code>`,
and `<a>`, which no primitive covers. Because no primitive covers a list or a
table, those elements may also carry their own layout (`display`,
`flex-direction`) in `MarkdownText.css`; rule 3 does not apply to them. Every
rule in that stylesheet reads a design token. No other component may render
those elements.

## 2. Typography goes through `base/`

Use `Heading` and `Text`. Never write `<h1>`–`<h6>` or `<p>`.

## 3. Never override a primitive's basic properties

Do not pass `display`, `flex`, `flex-direction`, or `grid-template-columns`
through `style` to fight a prop, and do not re-declare them in a component's
stylesheet. Inline styles and component CSS both beat a media query, so a
hand-set value silently defeats the responsive rules in `Grid.css`. If a layout
is wrong, fix the primitive.

## 4. Styling

- Pure CSS files. No Tailwind, no CSS-in-JS.
- Read every colour, space, radius, and border through `var(--token)`. A
  literal is a defect.
- **Scope a region's specific rules under its id.** `#chat-panel`, `#page`,
  `#sources-panel`: id selectors match one element and cannot leak into a
  sibling region. Write them as `#chat-panel { … }` in the owning stylesheet.
- Use a class only for appearance shared by many elements, such as
  `.source-item` or `.message-bubble--user`.
- No `border-radius` and no `box-shadow`. The system is flat and square.
- Use the derived `-muted` and `-active` variants for interaction states.

## 5. Components are small and composed

Prefer composing the kit over adding a component. If a component only wraps
another one, pass props instead. Every component has one job.

## 6. Files

- One component per file; the file name matches the component.
- One stylesheet per component, imported last. The import is required: a
  component whose stylesheet is not imported renders completely unstyled.
- No colocated test files in this directory yet. Front-end tests are out of
  scope for now. A missing `Foo.test.tsx` is expected, not an oversight.

## 7. Hooks

- Respect the Rules of Hooks.
- Keep state where it is used. Lift only when a sibling needs it.
- Never store derived values in state.
- `useEffect` synchronises with an external system. It never derives render
  output.
- Do not add `useMemo` or `useCallback` without a measured need.
