import type { FC, ReactNode } from "react"

import { VStack } from "../layout/VStack"
import type { GapToken } from "../utils/spacing"
import type { LayoutTag } from "../utils/tag"

import "./Panel.css"

/** Props of the panel. */
export interface PanelProps {
	/** Panel content. */
	children?: ReactNode;
	/** Gap between children. @defaultValue "md" */
	gap?: GapToken;
	/** Inner space on every side. @defaultValue "lg" */
	padding?: GapToken;
	/** Element rendered. @defaultValue "section" */
	as?: LayoutTag;
	/** Extra class for the component's own rules. */
	className?: string;
}

/**
 * A bordered surface that groups one region of the page. Flat and square: a
 * hairline border separates it, never a shadow.
 *
 * @param props - Gap, inner space, and element override.
 * @returns The panel surface.
 * @example
 * <Panel as="aside" gap="sm">Slogans</Panel>
 */
export const Panel: FC<PanelProps> = ({
	children,
	gap = "md",
	padding = "lg",
	as = "section",
	className = "",
}) => (
	<VStack
		as={as}
		gap={gap}
		padding={padding}
		align="stretch"
		className={`panel ${className}`.trim()}
	>
		{children}
	</VStack>
)