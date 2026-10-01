import { type CSSProperties, type FC } from "react"

import type { LayoutTag } from "../utils/tag"
import { buildSpacingStyle, type GapProps, type SpacingProps } from "../utils/spacing"
import { type StackBaseProps, stackContentStyle } from "./utils/stack"

import "./HStack.css"

/** Cross-row alignment of children inside a horizontal stack. */
type HStackAlign = "top" | "bottom" | "center" | "baseline" | "flex-start" | "flex-end";

/** Props of the horizontal flex stack. */
export interface HStackProps extends SpacingProps, GapProps, StackBaseProps {
	/** Where children sit along the row. @defaultValue "left" */
	stackItems?: "left" | "right" | "center" | "justify" | "evenly";
	/** How children line up across the row. @defaultValue "center" */
	alignItems?: HStackAlign;
	/** Semantic grouping element rendered by the stack. @defaultValue "div" */
	as?: LayoutTag;
}

/** `stackItems` → `--layout-stack-items` value (only non-default values needed). */
const STACK_ITEMS: Record<Exclude<HStackProps["stackItems"], undefined>, string> = {
	left: "flex-start",
	right: "flex-end",
	center: "center",
	justify: "space-between",
	evenly: "space-evenly",
};

/** `alignItems` → `--layout-align-items` value (only non-default values needed). */
const ALIGN_ITEMS: Record<HStackAlign, string> = {
	top: "flex-start",
	bottom: "flex-end",
	center: "center",
	baseline: "baseline",
	"flex-start": "flex-start",
	"flex-end": "flex-end",
};

/**
 * Horizontal flex container: children flow left to right.
 * Compose rows of controls and chips with it instead of raw divs.
 *
 * @param props - Stack direction is fixed; everything else comes from
 *   spacing/gap tokens plus the intuitive placement keywords.
 * @returns A flex row element (`as`, default `<div>`).
 * @example
 * <HStack gap="sm" alignItems="top" as="header">
 *   <Heading level={1}>Titre</Heading>
 *   <Button>Envoyer</Button>
 * </HStack>
 */
export const HStack: FC<HStackProps> = ({
	children,
	className = "",
	style,
	gap = "base",
	wrap = false,
	inline = false,
	as = "div",
	stackItems,
	alignItems,
	...spacing
}) => {
	const Tag = as
	const mergedStyle: CSSProperties = {
		...buildSpacingStyle(spacing),
		...stackContentStyle(gap, wrap),
		...(stackItems ? { "--layout-stack-items": STACK_ITEMS[stackItems] } : {}),
		...(alignItems ? { "--layout-align-items": ALIGN_ITEMS[alignItems] } : {}),
		...style,
	}

	const baseClass = inline ? "h-stack h-stack--inline" : "h-stack"

	// Compose classes without stray spaces when className is empty.
	const allClasses = [baseClass, className].filter(Boolean).join(" ")

	return (
		<Tag className={allClasses} style={mergedStyle}>
			{children}
		</Tag>
	)
}