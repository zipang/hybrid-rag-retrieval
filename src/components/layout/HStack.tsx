import type { CSSProperties, FC, ReactNode } from "react"

import type { GapToken } from "../utils/spacing"
import type { LayoutTag } from "../utils/tag"

import "./HStack.css"

/** How children are placed along the row. */
type HStackJustify = "start" | "center" | "end" | "between";

/** How children line up across the row. */
type HStackAlign = "start" | "center" | "end" | "baseline" | "stretch";

/** Props of the horizontal stack. */
export interface HStackProps {
	/** Content laid out in a row. */
	children?: ReactNode;
	/** Space between children. @defaultValue "md" */
	gap?: GapToken;
	/** How children are distributed along the row. @defaultValue "start" */
	justify?: HStackJustify;
	/** How children line up across the row. @defaultValue "stretch" */
	align?: HStackAlign;
	/** Space around the stack, on every side. @defaultValue none */
	padding?: GapToken;
	/** Allow children to wrap onto new lines. @defaultValue false */
	wrap?: boolean;
	/** Element rendered. @defaultValue "div" */
	as?: LayoutTag;
	/** Extra class for the component's own rules. */
	className?: string;
	/** Extra inline styles, merged last. @defaultValue none */
	style?: CSSProperties;
}

/** `justify` → the CSS `justify-content` value. */
const JUSTIFY: Record<HStackJustify, string> = {
	start: "flex-start",
	center: "center",
	end: "flex-end",
	between: "space-between",
};

/** `align` → the CSS `align-items` value. */
const ALIGN: Record<HStackAlign, string> = {
	start: "flex-start",
	center: "center",
	end: "flex-end",
	baseline: "baseline",
	stretch: "stretch",
};

/**
 * Horizontal flex container: children flow left to right.
 *
 * @param props - Gap, distribution, alignment, padding, wrapping, and element
 *   override.
 * @returns A flex row element.
 * @example
 * <HStack gap="sm" justify="between" as="header">
 *   <Heading level={1}>Titre</Heading>
 *   <Button>Envoyer</Button>
 * </HStack>
 */
export const HStack: FC<HStackProps> = ({
	children,
	gap = "md",
	justify = "start",
	align = "stretch",
	padding = "none",
	wrap = false,
	as = "div",
	className = "",
	style,
}) => {
	const Tag = as
	const classes = ["h-stack", className].filter(Boolean).join(" ")

	return (
		<Tag
			className={classes}
			style={{
				gap: `var(--space-${gap})`,
				justifyContent: JUSTIFY[justify],
				alignItems: ALIGN[align],
				padding: padding === "none" ? undefined : `var(--space-${padding})`,
				flexWrap: wrap ? "wrap" : "nowrap",
				...style,
			}}
		>
			{children}
		</Tag>
	)
}