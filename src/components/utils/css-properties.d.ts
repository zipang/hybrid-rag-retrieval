/**
 * The CSS custom properties this project's layout primitives emit and their
 * stylesheets read. Registering them keeps `CSSProperties` honest instead of
 * forcing a cast at every assignment. Every entry is optional because a
 * component emits only the props its caller supplied.
 */
type LayoutCustomProperties = {
	/** Space between the children of a stack or grid. */
	"--layout-gap"?: string
	/** Space between the columns of a grid. */
	"--layout-column-gap"?: string
	/** Space between the rows of a grid. */
	"--layout-row-gap"?: string
	/** `flex-wrap` value chosen by a stack. */
	"--layout-wrap"?: string
	/** `justify-content` value chosen by a stack. */
	"--layout-stack-items"?: string
	/** `align-items` value chosen by a stack. */
	"--layout-align-items"?: string
	/** Shorthand margin. */
	"--layout-margin"?: string
	/** Horizontal margin. */
	"--layout-margin-x"?: string
	/** Vertical margin. */
	"--layout-margin-y"?: string
	/** Top margin. */
	"--layout-margin-top"?: string
	/** Right margin. */
	"--layout-margin-right"?: string
	/** Bottom margin. */
	"--layout-margin-bottom"?: string
	/** Left margin. */
	"--layout-margin-left"?: string
	/** Shorthand padding. */
	"--layout-padding"?: string
	/** Horizontal padding. */
	"--layout-padding-x"?: string
	/** Vertical padding. */
	"--layout-padding-y"?: string
	/** Top padding. */
	"--layout-padding-top"?: string
	/** Right padding. */
	"--layout-padding-right"?: string
	/** Bottom padding. */
	"--layout-padding-bottom"?: string
	/** Left padding. */
	"--layout-padding-left"?: string
	/** `grid-template-columns` value chosen by the grid. */
	"--grid-template-columns"?: string
	/** `grid-template-rows` value chosen by the grid. */
	"--grid-template-rows"?: string
	/** `grid-auto-rows` value chosen by the grid. */
	"--grid-auto-rows"?: string
}

declare module "react" {
	interface CSSProperties extends CSSProperties, LayoutCustomProperties {}
}

export type {}
