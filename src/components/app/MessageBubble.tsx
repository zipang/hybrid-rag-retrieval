import type { FC } from "react";

import { VStack } from "../layout/VStack";
import { Text } from "../base/Text";
import { MarkdownText } from "./MarkdownText";

import "./MessageBubble.css";

/** Author of a chat message. */
export type MessageRole = "user" | "assistant";

/** Props of one chat message. */
export interface MessageBubbleProps {
	/** Who wrote it; drives the surface and the alignment. */
	role: MessageRole;
	/** The message body, complete or still streaming. */
	text: string;
	/** Marks an answer still arriving from the server. @defaultValue false */
	isStreaming?: boolean;
}

/**
 * One chat message, at the same size as the question field. The two roles are distinguished by
 * surface tone and by which edge the block sits against. The assistant body is rendered as Markdown
 * through {@link MarkdownText}; the user body is plain text.
 *
 * @example
 * 	<MessageBubble role="user" text="Slogans sur le sucre" />;
 *
 * @param props - Author, body, and the streaming flag.
 * @returns The message block.
 */
export const MessageBubble: FC<MessageBubbleProps> = ({ role, text, isStreaming = false }) => (
	<VStack
		gap="xs"
		align="start"
		className={`message-bubble message-bubble--${role}${isStreaming ? " message-bubble--streaming" : ""}`}
	>
		<Text size="xs" weight="medium" as="span" className="message-bubble__author">
			{role === "user" ? "Vous" : "Assistant"}
		</Text>
		{role === "assistant" ? (
			<MarkdownText text={text} />
		) : (
			<Text size="sm" tone="ondark" as="span" className="message-bubble__body">
				{text}
			</Text>
		)}
	</VStack>
);
