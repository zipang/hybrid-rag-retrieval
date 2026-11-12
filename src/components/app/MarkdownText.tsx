import type { FC } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { VStack } from "../layout/VStack";
import { Heading } from "../base/Heading";
import { Text } from "../base/Text";

import "./MarkdownText.css";

/** Props of the Markdown renderer. */
export interface MarkdownTextProps {
	/** The Markdown source of the agent answer. */
	text: string;
}

/**
 * Render the agent answer as Markdown.
 *
 * This is the only component allowed to render a raw `<ul>`, `<ol>`, `<li>`, `<table>`, `<thead>`,
 * `<tbody>`, `<tr>`, `<th>`, or `<td>`: the component kit has no primitive for them. The exception
 * is documented in `src/components/AGENTS.md`. Raw HTML in the model output is dropped
 * (`skipHtml`), so a model answer can never inject markup.
 *
 * @example
 * 	<MarkdownText text="**Danone** (1991) : *Un peu de sucre*." />;
 *
 * @param props - The Markdown source.
 * @returns The formatted answer.
 */
export const MarkdownText: FC<MarkdownTextProps> = ({ text }) => (
	<VStack gap="sm" className="markdown-text">
		<Markdown
			remarkPlugins={[remarkGfm]}
			skipHtml
			components={{
				p: ({ children }) => <Text as="p">{children}</Text>,
				// Inline emphasis has no primitive; keep the semantic element.
				strong: ({ children }) => (
					<strong className="markdown-text__strong">{children}</strong>
				),
				em: ({ children }) => <em className="markdown-text__em">{children}</em>,
				code: ({ children }) => <code className="markdown-text__code">{children}</code>,
				a: ({ href, children }) => (
					<a className="markdown-text__link" href={href}>
						{children}
					</a>
				),
				h1: ({ children }) => (
					<Heading level={1} size="lg">
						{children}
					</Heading>
				),
				h2: ({ children }) => (
					<Heading level={2} size="md">
						{children}
					</Heading>
				),
				h3: ({ children }) => (
					<Heading level={3} size="md">
						{children}
					</Heading>
				),
				h4: ({ children }) => (
					<Heading level={4} size="sm">
						{children}
					</Heading>
				),
				h5: ({ children }) => (
					<Heading level={4} as="h5" size="sm">
						{children}
					</Heading>
				),
				h6: ({ children }) => (
					<Heading level={4} as="h6" size="sm">
						{children}
					</Heading>
				),
				ul: ({ children }) => <ul className="markdown-text__list">{children}</ul>,
				ol: ({ children }) => <ol className="markdown-text__list">{children}</ol>,
				li: ({ children }) => <li className="markdown-text__item">{children}</li>,
				table: ({ children }) => <table className="markdown-text__table">{children}</table>,
				thead: ({ children }) => <thead>{children}</thead>,
				tbody: ({ children }) => <tbody>{children}</tbody>,
				tr: ({ children }) => <tr>{children}</tr>,
				th: ({ children }) => (
					<th className="markdown-text__cell markdown-text__cell--head">{children}</th>
				),
				td: ({ children }) => <td className="markdown-text__cell">{children}</td>
			}}
		>
			{text}
		</Markdown>
	</VStack>
);
