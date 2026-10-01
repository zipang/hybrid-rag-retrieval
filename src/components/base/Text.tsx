import type { CSSProperties, FC, ReactNode } from "react"

import "./Text.css"

/** Font-size scale tokens from the Design System (`--font-size-*`). */
export type TextSize = "xs" | "sm" | "md" | "lg" | "xl";

/** Color role of the text. */
export type TextTone = "base" | "accent" | "muted" | "ondark";

/** Element the text renders as, when it must differ from a paragraph. */
export type TextTag = "p" | "span" | "li" | "label" | "figcaption" | "blockquote";

/** Horizontal alignment of the text. */
export type TextAlign = "left" | "center" | "right";

/** Props of the Design System text block. */
export interface TextProps {
	/** Font-size token from the scale. @defaultValue "md" */
	size?: TextSize;
	/** Color role of the text. @defaultValue "base" */
	tone?: TextTone;
	/** Weight token from the scale. @defaultValue "regular" */
	weight?: "regular" | "medium" | "semibold" | "bold";
	/** Horizontal alignment of the text. @defaultValue inherits (left) */
	textAlign?: TextAlign;
	/** Render as this element instead of a paragraph. @defaultValue "p" */
	as?: TextTag;
	/**
	 * Id of the control this text labels. Only meaningful with `as="label"`.
	 * @defaultValue none (unset)
	 */
	htmlFor?: string;
	/** Extra classes appended to the component's own class. */
	className?: string;
	/** Content of the text block. */
	children: ReactNode;
}

/**
 * Renders text styled exclusively from the Design System typography tokens.
 * Direct usage of `<p>` is forbidden in pages and app components; use this
 * component instead.
 *
 * @param props - Optional size, tone, weight, and element overrides plus the
 *   text content.
 * @returns The chosen element carrying the `text` class.
 * @example
 * <Text>Body copy.</Text>
 * <Text size="sm" tone="muted">Recherche hybride dense + BM25</Text>
 */
export const Text: FC<TextProps> = ({
	size = "md",
	tone = "base",
	weight = "regular",
	textAlign,
	as = "p",
	htmlFor,
	className = "",
	children,
}) => {
	const Tag = as
	const style: CSSProperties = { textAlign }
	const allClasses = ["text", `text--${size}`, `text--${tone}`, `text--${weight}`, className]
		.filter(Boolean)
		.join(" ")

	return (
		<Tag
			className={allClasses}
			style={style}
			{...(htmlFor ? { htmlFor } : {})}
		>
			{children}
		</Tag>
	)
}