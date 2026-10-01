import type { CSSProperties, ReactNode } from "react"

import { type SpaceToken, spaceVar } from "../../utils/spacing"

/** Props every stack component shares on top of spacing and gap. */
export interface StackBaseProps {
	/** Content laid out by the stack. */
	children?: ReactNode
	/** Extra classes appended to the component's own class. */
	className?: string
	/** Extra inline styles merged after the stack's own (custom props,
	 *  accents); last write wins. @defaultValue none (unset) */
	style?: CSSProperties
	/** Allow children to wrap onto new rows. @defaultValue false */
	wrap?: boolean
	/** Render as inline-flex instead of flex. @defaultValue false */
	inline?: boolean
}

/**
 * Builds the custom properties a stack's stylesheet reads.
 *
 * The gap travels as `--layout-gap` rather than as an inline `gap` value, so
 * the `var(--space-*)` reference stays in CSS where the Design System can be
 * audited.
 *
 * @param gap - Token naming the space between children.
 * @param wrap - Whether children may wrap onto new rows.
 * @returns A style object carrying `--layout-gap` and `--layout-wrap`.
 * @example
 * stackContentStyle("md", false)
 * // { "--layout-gap": "var(--space-md)", "--layout-wrap": "nowrap" }
 */
export const stackContentStyle = (gap: SpaceToken, wrap: boolean): CSSProperties => ({
	"--layout-gap": spaceVar(gap),
	"--layout-wrap": wrap ? "wrap" : "nowrap",
})
