---
version: alpha
name: Reference Design System

# ============================================================================
# COLORS  —  every entry maps to a --color-* CSS variable
# Required tokens must appear here. Optional tokens appear only when the
# designer overrides their stylesheet fallback.
# ============================================================================
colors:
  # Brand — primary and accent are required; secondary and tertiary are
  # optional.
  brand:
    primary:   "#ff0000"   # --color-brand-primary   (headings, highlights, logo)
    accent:    "#065fd4"   # --color-brand-accent    (CTAs, key accents)
    secondary: "#606060"   # --color-brand-secondary (optional, overridden)
    # tertiary: omitted → --color-brand-tertiary: var(--color-brand-primary)

  # Action — all four are required
  action:
    success: "#137333"     # --color-action-success
    info:    "#1a73e8"     # --color-action-info
    warning: "#e37400"     # --color-action-warning
    danger:  "#d93025"     # --color-action-danger

  # Text  (drop-.base rule: colors.text.base -> --color-text)
  text:
    base:    "#0f0f0f"     # --color-text
    accent:  "#065fd4"     # --color-text-accent
    muted:   "#606060"     # --color-text-muted
    ondark:  "#ffffff"     # --color-text-ondark

  # Surface  (drop-.base rule: colors.surface.base -> --color-surface)
  surface:
    base: "#ffffff"        # --color-surface
    alt:  "#f9f9f9"        # --color-surface-alt
    dark: "#0f0f0f"        # --color-surface-dark      (optional, overridden)
    # card:  omitted → --color-surface-card: var(--color-surface)

# ============================================================================
# TYPOGRAPHY  —  entries are objects;
# fontFamily, fontWeight, lineHeight, letterSpacing values MUST use existing preset values from styles.css (CSS variables)
# ============================================================================
typography:
  # Font families — No font size
  base: {
    fontFamily: "Roboto, Arial, sans-serif",
    fontWeight: "var(--font-weight-regular)",
    lineHeight: "var(--line-height-normal)"
  }
  display: {
    fontFamily: "Roboto, Arial, sans-serif",
    fontWeight: "var(--font-weight-semibold)",
    lineHeight: "var(--line-height-tight)",
    letterSpacing: "var(--letter-spacing-tight)"
  }
  mono: {
    fontFamily: 'ui-monospace, "Courier New", monospace'
  }

# ============================================================================
# ROUNDED  —  corner radius presets (only full is required;
# none, sm, md, lg are optional)
# Values in rem, except full (9999px for circular shapes).
# ============================================================================
rounded:
  none: "0"
  sm:   "0.25rem"
  md:   "0.75rem"
  lg:   "1.125rem"
  full: "9999px"   # circular — avatars, icons, pills

# ============================================================================
# SPACING  —  spatial rhythm scale, 4px linear (all required)
# ============================================================================
spacing:
  xs:   "0.25rem"
  sm:   "0.5rem"
  md:   "0.75rem"
  base: "1rem"
  lg:   "1.25rem"
  xl:   "2rem"
  xxl:  "3rem"

# ============================================================================
# ELEVATION  —  custom top-level family (shadow presets; optional, default none)
# Values match the flat preset — import from presets/elevation/flat.css.
# ============================================================================
elevation:
  sm: "none"
  md: "none"
  lg: "none"

# ============================================================================
# BORDER  —  custom top-level family (border WIDTHS; all required)
# Values match the 124 preset — import from presets/borders/124.css.
# Border COLORS are not tokens — components pick them under `components`.
# ============================================================================
border:
  sm: "1px"
  md: "2px"
  lg: "4px"
---

## Overview

This is a reference DESIGN.md demonstrating the dual-file token contract from
the `design-system-tokens` skill. The front matter above lists every required
token plus a selection of optional tokens. Optional tokens that are omitted
here still exist in the stylesheet with a `var()` fallback to a required token.

## Colors

- **Primary (`#ff0000`)** — YouTube Red. Headings, highlights, contrast, logo.
- **Accent (`#065fd4`)** — Link Blue. CTAs, key accents, links.
- **Secondary (`#606060`)** — Neutral gray. Additional brand color for
  decorative surfaces.
- **Tertiary** — omitted; the stylesheet falls back to `var(--color-brand-primary)`.
- **Success (`#137333`)** — Form success, confirmation.
- **Info (`#1a73e8`)** — Informational messages.
- **Warning (`#e37400`)** — Warnings, cautionary messages.
- **Danger (`#d93025`)** — Errors, destructive actions.
- **Text base (`#0f0f0f`)** — Body text.
- **Text accent (`#065fd4`)** — Accented text, links, headings.
- **Text muted (`#606060`)** — Subdued text: visited links, notes.
- **Text ondark (`#ffffff`)** — Text on dark surfaces: footer, dark sections.
- **Surface base (`#ffffff`)** — Default page background.
- **Surface alt (`#f9f9f9`)** — Alternating sections.
- **Surface dark (`#0f0f0f`)** — Footer, dark sections.
- **Surface card** — omitted; falls back to `var(--color-surface)`.

### Color variants

Brand and action colors carry `muted` and `active` variants derived
automatically from the base color via CSS relative color syntax:

- `muted`  — `hsl(from <base> h calc(s * 0.8) calc(l * 1.2))` — less
  saturated, lighter; the softened, resting variant.
- `active` — `hsl(from <base> h calc(s * 1.2) calc(l * 1.1))` — more
  saturated, lighter; the vivid hover/pressed variant.

Only `brand` and `action` colors carry these variants, because they are used
on interactive elements with states. Text and surface colors define their own
variants explicitly in the token tables. These derived variants are **not
design tokens** — do not list them in the front matter. They are generated in
`color-variants.css`, included after the main design-tokens stylesheet.

## Typography

Body and headings use Roboto (Arial fallback). Code and labels use
`ui-monospace`. The type scale is geometric with ratio 1.5 (Perfect Fifth):
`size(step) = 1rem * 1.5^step`, so `md` is `1rem`, `lg` `1.5rem`, `xl`
`2.25rem`, and `xs`/`sm` go down to `0.444rem`/`0.667rem`. Font sizes are
defined in the stylesheet only — they are not front-matter entries. The
optional `2xl` and `display` steps fall back to `var(--font-size-xl)` unless
overridden in the stylesheet.

## Layout

A 4px linear spacing scale with 1rem (16px) as the base step. Content is
constrained to a max-width of 1200px with generous section padding.

## Elevation & Depth

The design is flat — all elevation tokens are set to `none` (flat preset).
Depth is conveyed through color contrast and spacing rather than shadows.

## Shapes

Corner radii range from 4px (0.25rem — chips, inputs) to 9999px (circular
avatars). Cards and thumbnails use 0.75rem. Pill buttons and large chips use
1.125rem.

## Components

Components pick the color tokens they need for their states and variants.

### Link

The Link component uses `colors.brand.accent` for its default color. Its
interactive states leverage the derived variants from `color-variants.css`:

- **default** — `textColor: "{colors.brand.accent}"` → `--color-brand-accent`
- **hover and active** — rendered with `--color-brand-accent-active` (more
  saturated, lighter — the vivid variant)
- **visited** — rendered with `--color-brand-accent-muted` (less saturated,
  lighter — the resting variant)

In the stylesheet this maps to:

```css
a {
    color: var(--color-brand-accent);
    text-decoration: underline;
}
a:hover,
a:active {
    color: var(--color-brand-accent-active);
}
a:visited {
    color: var(--color-brand-accent-muted);
}
```

The same pattern applies to other components that need specific colors for
their variants — e.g. a Card component may pick `colors.surface` for its
background and `colors.brand.primary` for an accented border when focused.

## DO's and DON'Ts

- Do use the accent color only for the most important action per screen
- Do use `var()` fallbacks for optional tokens in the stylesheet
- Do not list the derived `muted` / `active` variants as tokens in the front
  matter — they are generated in `color-variants.css`
- Do not redefine `--elevation-*` or `--border-*` in the main stylesheet —
  import the chosen preset instead
