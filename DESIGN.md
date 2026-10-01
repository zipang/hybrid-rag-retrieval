---
colors:
  brand:
    primary: "#1a1a1a" # near-black — headings, logo, emphasis
    accent: "#1d4ed8" # single blue — primary action and focus ring only
    secondary: "#4b5563" # neutral gray — secondary surfaces
    tertiary: "#1a1a1a" # same as primary
  action:
    success: "#15803d" # confirmed states
    info: "#1d4ed8" # neutral notice
    warning: "#b45309" # cautionary states
    danger: "#b91c1c" # errors and destructive actions
  text:
    base: "#1a1a1a" # body copy on light surfaces
    accent: "#1d4ed8" # links and emphasised text
    muted: "#6b7280" # metadata, timestamps, captions
    ondark: "#fafafa" # text on --color-surface-dark
  surface:
    base: "#fafafa" # page background
    alt: "#f0f0f0" # alternating bands, composer's well
    card: "#ffffff" # panels and form surfaces
    dark: "#1a1a1a" # footer and inverted bands
typography:
  base:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    lineHeight:
      tight: "1.15"
      normal: "1.5"
      relaxed: "1.7"
  display:
    # fontFamily omitted → --font-family-display: var(--font-family-base)
  # mono omitted → --font-family-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace
  scale:
    base: "1rem" # step 0, applied to the document
    xs: "0.694rem" # captions, metadata, timestamps
    sm: "0.833rem" # chat messages, list rows, secondary text
    md: "1rem" # body text, input fields
    lg: "1.2rem" # section titles
    xl: "1.44rem" # page title
    "2xl": "1.728rem" # hero titles
    display: "2.074rem" # banner headlines
  weights:
    regular: "400"
    medium: "500"
    semibold: "600"
    bold: "700"
    # extrabold omitted → --font-weight-extrabold: var(--font-weight-bold)
  letterSpacing:
    tight: "-0.02em"
    normal: "0"
    wide: "0.02em"
spacing:
  xs: "0.25rem" # 4px
  sm: "0.5rem" # 8px
  md: "0.75rem" # 12px
  base: "1rem" # 16px, step 0
  lg: "1.5rem" # 24px
  xl: "2.5rem" # 40px
  xxl: "4rem" # 64px
rounded:
  none: "0" # flat design: square everywhere
  sm: "0" # flat design: square everywhere
  md: "0" # flat design: square everywhere
  lg: "0" # flat design: square everywhere
  full: "0" # flat design: square everywhere
elevation:
  sm: "none" # imported from presets/elevation/flat.css
  md: "none" # imported from presets/elevation/flat.css
  lg: "none" # imported from presets/elevation/flat.css
border:
  sm: "1px" # imported from presets/borders/124.css
  md: "2px" # imported from presets/borders/124.css
  lg: "4px" # imported from presets/borders/124.css
components:
  Button:
    background: "--color-brand-accent"
    backgroundActive: "--color-brand-accent-active"
    backgroundDisabled: "--color-brand-accent-muted"
    text: "--color-text-ondark"
    border: "--border-sm solid --color-brand-accent"
    borderFocus: "--border-md solid --color-brand-accent"
  ChatPanel:
    background: "--color-surface-card"
    border: "--border-sm solid --color-surface-alt"
  MessageBubble:
    backgroundUser: "--color-brand-primary"
    textUser: "--color-text-ondark"
    backgroundAssistant: "--color-surface-alt"
    textAssistant: "--color-text"
  RetrievalPanel:
    background: "--color-surface-card"
    border: "--border-sm solid --color-surface-alt"
  MessageBubbleError:
    background: "--color-action-danger-muted"
    border: "--border-sm solid --color-action-danger"
    text: "--color-action-danger"
---

# Design System

## Overview

A utilitarian, light interface for a retrieval tool. This is a working surface,
not a brand surface, so it stays quiet: neutral backgrounds, one accent colour,
no decoration. Nothing earns its place unless it helps the reader find a slogan
or read an answer.

## Colors

The palette is a light neutral scale. Surfaces step from `#fafafa` through
`#f0f0f0` to `#ffffff` for raised panels, and are separated by a single hairline
border rather than a shadow.

`colors.brand.accent` is the only chromatic colour. It appears on the primary
action and on focus rings, and nowhere else. The four action colours are reserved
for feedback and never used decoratively.

### Color variants

Brand and action colours carry `muted` and `active` variants, derived
automatically in `color-variants.css` and never declared as tokens:

```css
--color-brand-primary-muted: hsl(from var(--color-brand-primary) h calc(s * 0.8) calc(l * 1.2));
--color-brand-primary-active: hsl(from var(--color-brand-primary) h calc(s * 1.2) calc(l * 1.1));
```

`muted` is the resting state for a disabled control, `active` is hover and
pressed.

## Typography

The system font stack is used throughout, including for display text. No web font
is downloaded and no font file is served, so `fonts.css` declares no `@font-face`.

The scale is a geometric progression with ratio 1.2, so every step is 20 percent
larger than the one below it. `md` is step 0 and equals exactly `1rem`, which
keeps body text at the browser default size.

The application is a dense working tool, so the scale stays small. Chat messages
use `sm` and are never larger than the input field, which uses `md`.

| Token | Size | Used for |
|---|---|---|
| `--font-size-xs` | 0.694rem | Captions, timestamps, metadata |
| `--font-size-sm` | 0.833rem | Chat messages, list rows, hits |
| `--font-size-md` | 1rem | Body text, input fields |
| `--font-size-lg` | 1.2rem | Section titles |
| `--font-size-xl` | 1.44rem | Page title |
| `--font-size-2xl` | 1.728rem | Hero titles |
| `--font-size-display` | 2.074rem | Reserved for a banner |

## Layout

Spacing is a linear scale on 4px steps. `spacing.base` is the step 0 and equals
`1rem`. Because there is no shadow to separate regions, spacing does the
structural work: a gap of `xl` reads as a different region, a gap of `xs` reads
as belonging to the same one.

## Elevation and Depth

There is none. Every elevation token resolves to `none`, and the flat preset is
imported from `presets/elevation/flat.css` rather than restated here. Depth is
expressed with surface tone, a hairline border, and space.

## Shapes

There are none. Every `rounded` token resolves to `0`, including `rounded.full`,
which is retained for API compatibility but is square in this system.

## Components

Border *colours* are not tokens. Each component picks the colour tokens it needs
for its own states, as shown in the front matter. For example, the primary button
uses `--color-brand-accent` at rest, `--color-brand-accent-active` while pressed,
and `--color-brand-accent-muted` while disabled.

## Do's and Don'ts

- Do use `--space-*` tokens for every gap and offset.
- Do read colour through `var()`, never a literal.
- Do reach for a larger type step before adding a colour or a border to create emphasis.
- Don't add a border radius, a shadow, a gradient, or a web font.
- Don't use an action colour for anything other than the state it names.
- Don't rely on colour alone to convey a state; pair it with text or a weight change.