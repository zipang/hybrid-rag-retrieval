import type { CSSProperties, FC, ReactNode } from "react"

import type { GapToken } from "../utils/spacing"
import type { LayoutTag } from "../utils/tag"

import "./Grid.css"

/** Props of the grid container. */
export interface GridProps {
	/** Content laid out in a grid. */
	children?: ReactNode;
	/**
	 * Named column layout. `"split"` is a wide region beside a narrower one;
	 * the numeric values are equal columns.
	 * @defaultValue 1
	 */
	columns?: 1 | 2 | 3 | "split";
	/** Space between children. @defaultValue "md" */
	gap?: GapToken;
	/** Space around the grid, on every side. @defaultValue none */
	padding?: GapToken;
	/** Element rendered. @defaultValue "div" */
	as?: LayoutTag;
	/** Extra class for the component's own rules. */
	className?: string;
	/** Extra inline styles, merged last. @defaultValue none */
	style?: CSSProperties;
}

/**
 * Grid container. Use it for the page's main regions; use the stacks for
 * everything inside a region. The column layout is a class, so a media query
 * in `Grid.css` collapses it on a narrow viewport.
 *
 * @param props - Column layout, gap, and padding.
 * @returns A grid element.
 * @example
 * <Grid columns="split" gap="lg" as="main">
 *   <ChatPanel />
 *   <RetrievalPanel />
 * </Grid>
 */
export const Grid: FC<GridProps> = ({
	children,
	columns = 1,
	gap = "md",
	padding = "none",
	as = "div",
	className = "",
	style,
}) => {
	const Tag = as
	const layoutClass = typeof columns === "number" ? `grid--cols-${columns}` : `grid--${columns}`
	const classes = ["grid", layoutClass, className].filter(Boolean).join(" ")

	return (
		<Tag
			className={classes}
			style={{
				gap: `var(--space-${gap})`,
				padding: padding === "none" ? undefined : `var(--space-${padding})`,
				...style,
			}}
		>
			{children}
		</Tag>
	)
}