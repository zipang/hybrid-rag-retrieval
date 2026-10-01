import type { CSSProperties, FC, ReactNode } from "react"

import "./Heading.css"

/** Semantic heading levels rendered as their native tags. */
export type HeadingLevel = 1 | 2 | 3 | 4;

/** Font-size scale tokens from the Design System (`--font-size-*`). */
export type HeadingSize = "sm" | "md" | "lg" | "xl" | "2xl" | "display";

/** Color role of the heading text. */
export type HeadingTone = "base" | "accent" | "muted";

/** Element the heading renders as, when it must differ from its level. */
export type HeadingTag = "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "p";

/** Props of the Design System heading. */
export interface HeadingProps {
	/** Heading semantic level; renders the matching native tag. */
	level: HeadingLevel;
	/** Font-size token from the scale; size does not derive from level.
	 *  @defaultValue depends on level (1 → "2xl", 2 → "xl", 3 → "lg", 4 → "md") */
	size?: HeadingSize;
	/** Color role of the heading text. @defaultValue "base" */
	tone?: HeadingTone;
	/** Horizontal alignment of the text. @defaultValue inherits (left) */
	textAlign?: "left" | "center" | "right";
	/** Render as this element instead of the level's native tag.
	 *  @defaultValue the tag matching `level` */
	as?: HeadingTag;
	/** Extra classes appended to the component's own class. @defaultValue none */
	className?: string;
	/** Id of the element, for its own scoped rules. @defaultValue none */
	id?: string;
	/** Content of the heading. */
	children: ReactNode;
}

/** Maps a heading level to its fallback size token when none is given. */
const DEFAULT_SIZE: Record<HeadingLevel, HeadingSize> = {
	1: "2xl",
	2: "xl",
	3: "lg",
	4: "md",
}

/**
 * Renders a native heading element styled exclusively from the Design System
 * typography tokens. Direct usage of `<h1>`–`<h6>` is forbidden in pages and
 * app components; use this component instead.
 *
 * @param props - Level for semantics, an optional size token overriding the
 *   level default, an optional tone, plus the heading content.
 * @returns The native heading tag carrying the `heading` class.
 * @example
 * <Heading level={1}>Recherche de slogans</Heading>
 * <Heading level={2} size="lg">Slogans trouvés</Heading>
 */
export const Heading: FC<HeadingProps> = ({
	level,
	size,
	tone = "base",
	textAlign,
	as,
	className = "",
	id,
	children,
}) => {
	const Tag = (as ?? `h${level}`) as HeadingTag
	const sizeToken = size ?? DEFAULT_SIZE[level]
	const style: CSSProperties = { textAlign }

	return (
		<Tag
			id={id}
			className={[`heading`, `heading--${sizeToken}`, `heading--${tone}`, className].filter(Boolean).join(" ")}
			style={style}
			data-level={level}
		>
			{children}
		</Tag>
	)
}