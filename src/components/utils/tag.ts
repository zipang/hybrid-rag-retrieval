/**
 * Elements a layout container may render as.
 *
 * The union is the enforcement: it rejects non-grouping tags (`span`, `li`,
 * `p`, …) so a layout container stays a grouping element.
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
	| "label"
	| "figure"
