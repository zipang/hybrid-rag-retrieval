import { type CSSProperties, type FC } from "react"

import type { LayoutTag } from "../utils/tag"
import { buildSpacingStyle, type GapProps, type SpacingProps } from "../utils/spacing"
import { type StackBaseProps, stackContentStyle } from "./utils/stack"

import "./VStack.css"

/** Cross-column alignment of children inside a vertical stack. */
type VStackAlign = "left" | "right" | "center";

/** Props of the vertical flex stack. */
export interface VStackProps extends SpacingProps, GapProps, StackBaseProps {
	/** Where children sit along the column. @defaultValue "top" */
	stackItems?: "top" | "bottom" | "center" | "justify" | "evenly";
	/** How children line up across the column. @defaultValue "left" */
	alignItems?: VStackAlign;
	/** Semantic grouping element rendered by the stack. @defaultValue "div" */
	as?: LayoutTag;
}

/** `stackItems` → `--layout-stack-items` value (only non-default values needed). */
const STACK_ITEMS: Record<Exclude<VStackProps["stackItems"], undefined>, string> = {
	top: "flex-start",
	bottom: "flex-end",
	center: "center",
	justify: "space-between",
	evenly: "space-evenly",
};

/** `alignItems` → `--layout-align-items` value (only non-default values needed). */
const ALIGN_ITEMS: Record<VStackAlign, string> = {
	left: "flex-start",
	right: "flex-end",
	center: "center",
};

/**
 * Vertical flex container: children flow top to bottom.
 * Compose screens and sections with it instead of raw divs.
 *
 * @param props - Stack direction is fixed; everything else comes from
 *   spacing/gap tokens plus the intuitive placement keywords.
 * @returns A flex column element (`as`, default `<div>`).
 * @example
 * <VStack gap="md" padding="lg" stackItems="justify" as="section">
 *   <Heading level={2}>Titre</Heading>
 *   <Text>Corps</Text>
 * </VStack>
 */
export const VStack: FC<VStackProps> = ({
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

	const baseClass = inline ? "v-stack v-stack--inline" : "v-stack"

	// Compose classes without stray spaces when className is empty.
	const allClasses = [baseClass, className].filter(Boolean).join(" ")

	return (
		<Tag className={allClasses} style={mergedStyle}>
			{children}
		</Tag>
	)
}