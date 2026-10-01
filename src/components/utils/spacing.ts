import type { CSSProperties } from "react"

/**
 * Spacing scale tokens defined in `design-tokens.css`.
 * Use token names only — raw CSS values are rejected at compile time so
 * DESIGN.md and design-tokens.css stay authoritative.
 */
export type SpaceToken = "none" | "xs" | "sm" | "md" | "base" | "lg" | "xl" | "xxl"

/** Props for the four box sides at once (margin, padding). */
export interface BoxAllProps {
	/** Space on every side. @defaultValue none (unset) */
	margin?: SpaceToken
	/** Inner space on every side. @defaultValue none (unset) */
	padding?: SpaceToken
}

/** Props targeting one axis of the box. */
interface BoxAxisProps {
	/** Horizontal margin shorthand (left + right). @defaultValue none (unset) */
	marginX?: SpaceToken
	/** Vertical margin shorthand (top + bottom). @defaultValue none (unset) */
	marginY?: SpaceToken
	/** Horizontal inner space shorthand (left + right). @defaultValue none (unset) */
	paddingX?: SpaceToken
	/** Vertical inner space shorthand (top + bottom). @defaultValue none (unset) */
	paddingY?: SpaceToken
}

/** Props targeting one single side of the box. */
interface BoxSideProps {
	/** Space above. @defaultValue none (unset) */
	marginTop?: SpaceToken
	/** Space to the right. @defaultValue none (unset) */
	marginRight?: SpaceToken
	/** Space below. @defaultValue none (unset) */
	marginBottom?: SpaceToken
	/** Space to the left. @defaultValue none (unset) */
	marginLeft?: SpaceToken
	/** Inner space above. @defaultValue none (unset) */
	paddingTop?: SpaceToken
	/** Inner space to the right. @defaultValue none (unset) */
	paddingRight?: SpaceToken
	/** Inner space below. @defaultValue none (unset) */
	paddingBottom?: SpaceToken
	/** Inner space to the left. @defaultValue none (unset) */
	paddingLeft?: SpaceToken
}

/**
 * Full spacing API shared by layout components: an all-sides shortcut plus
 * per-axis and per-side overrides. More specific props win over broader ones
 * (`paddingTop` beats `paddingY` beats `padding`).
 */
export interface SpacingProps extends BoxAllProps, BoxAxisProps, BoxSideProps {}

/** Props controlling the space between children of a layout container. */
export interface GapProps {
	/** Space between children. @defaultValue base (set by each component) */
	gap?: SpaceToken
}

/**
 * Converts a spacing token into its CSS value.
 *
 * @param token - One of the theme spacing tokens.
 * @returns `"0"` for `"none"`, otherwise a `var(--space-*)` reference.
 * @example
 * spaceVar("md") // "var(--space-md)"
 * spaceVar("none") // "0"
 */
export const spaceVar = (token: SpaceToken): string =>
	token === "none" ? "0" : `var(--space-${token})`

/**
 * A spacing prop name together with the CSS custom property it feeds.
 * The custom property name mirrors the CSS property it drives, so a
 * stylesheet can express specificity through its fallback chain:
 * `padding: var(--layout-padding, 0)` then
 * `padding-top: var(--layout-padding-top, var(--layout-padding-y, var(--layout-padding, 0)))`.
 */
type Axis = { prop: keyof SpacingProps; customProperty: string }

/** Every spacing prop, mapped to the custom property that carries it. */
const AXES: Axis[] = [
	{ prop: "margin", customProperty: "--layout-margin" },
	{ prop: "marginX", customProperty: "--layout-margin-x" },
	{ prop: "marginY", customProperty: "--layout-margin-y" },
	{ prop: "marginTop", customProperty: "--layout-margin-top" },
	{ prop: "marginRight", customProperty: "--layout-margin-right" },
	{ prop: "marginBottom", customProperty: "--layout-margin-bottom" },
	{ prop: "marginLeft", customProperty: "--layout-margin-left" },
	{ prop: "padding", customProperty: "--layout-padding" },
	{ prop: "paddingX", customProperty: "--layout-padding-x" },
	{ prop: "paddingY", customProperty: "--layout-padding-y" },
	{ prop: "paddingTop", customProperty: "--layout-padding-top" },
	{ prop: "paddingRight", customProperty: "--layout-padding-right" },
	{ prop: "paddingBottom", customProperty: "--layout-padding-bottom" },
	{ prop: "paddingLeft", customProperty: "--layout-padding-left" },
]

/**
 * Turns spacing props into CSS custom properties for the consuming stylesheet.
 *
 * Only props that were actually supplied are emitted. The stylesheet is
 * responsible for the specificity order through its own fallback chain, so this
 * function stays a plain token-to-variable mapping.
 *
 * @param props - Any subset of `SpacingProps`; absent props emit nothing.
 * @returns A style object of `--layout-*` custom properties, each holding
 *   `0` or a `var(--space-*)` reference.
 * @example
 * buildSpacingStyle({ margin: "md", paddingTop: "xl" })
 * // { "--layout-margin": "var(--space-md)", "--layout-padding-top": "var(--space-xl)" }
 */
export const buildSpacingStyle = (props: SpacingProps): CSSProperties => {
	const style: Record<string, string> = {}

	for (const { prop, customProperty } of AXES) {
		const token = props[prop]

		if (token === undefined) {
			continue
		}

		style[customProperty] = spaceVar(token)
	}

	// The AXES table is the only writer, and every property it names is
	// declared in css-properties.d.ts, so the cast stays honest.
	return style as unknown as CSSProperties
}
