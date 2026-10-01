import type { CSSProperties, FC, FormEventHandler, ReactNode } from "react"

import type { GapToken } from "../utils/spacing"
import type { LayoutTag } from "../utils/tag"

import "./VStack.css"

/** How children are placed along the column. */
type VStackAlign = "start" | "center" | "end" | "stretch";

/** Props of the vertical stack. */
export interface VStackProps {
	/** Content laid out in a column. */
	children?: ReactNode;
	/** Space between children. @defaultValue "md" */
	gap?: GapToken;
	/** How children line up across the column. @defaultValue "stretch" */
	align?: VStackAlign;
	/** Space around the stack, on every side. @defaultValue none */
	padding?: GapToken;
	/** Element rendered. @defaultValue "div" */
	as?: LayoutTag;
	/** Extra class for the component's own rules. */
	className?: string;
	/** Extra inline styles, merged last. @defaultValue none */
	style?: CSSProperties;
	/** Submit handler, forwarded when the stack renders a form. */
	onSubmit?: FormEventHandler<HTMLElement>;
}

/** `align` → the CSS `align-items` value. */
const ALIGN: Record<VStackAlign, string> = {
	start: "flex-start",
	center: "center",
	end: "flex-end",
	stretch: "stretch",
}

/**
 * Vertical flex container: children flow top to bottom.
 *
 * @param props - Gap, cross-axis alignment, padding, and element override.
 * @returns A flex column element.
 * @example
 * <VStack gap="md" as="section">
 *   <Heading level={2}>Titre</Heading>
 *   <Text>Corps</Text>
 * </VStack>
 */
export const VStack: FC<VStackProps> = ({
	children,
	gap = "md",
	align = "stretch",
	padding = "none",
	as = "div",
	className = "",
	style,
	onSubmit,
}) => {
	const Tag = as
	const classes = ["v-stack", className].filter(Boolean).join(" ")

	return (
		<Tag
			className={classes}
			style={{
				gap: `var(--space-${gap})`,
				alignItems: ALIGN[align],
				padding: padding === "none" ? undefined : `var(--space-${padding})`,
				...style,
			}}
			onSubmit={onSubmit}
		>
			{children}
		</Tag>
	)
}