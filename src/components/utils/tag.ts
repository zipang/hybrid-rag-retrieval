/**
 * Semantic HTML elements a layout container may render as.
 *
 * The union is the enforcement: TS rejects non-grouping tags (`span`, `a`,
 * `i`, `b`, `hr`, `img`, `br`, `li`, `p`, …) at every call site of a layout
 * component's `as` prop — a layout container must be a grouping element.
 *
 * @defaultValue `"div"` (chosen by each component)
 */
export type LayoutTag =
	| "div"
	| "section"
	| "article"
	| "aside"
	| "header"
	| "footer"
	| "nav"
	| "main"
	| "ul"
	| "ol"
	| "form"
	| "figure"
	| "fieldset"
