import type { FC } from "react"

import { VStack } from "../layout/VStack"
import { Text } from "../base/Text"

import "./MessageBubble.css"

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
 * One chat message, at the same size as the question field. The two roles are
 * distinguished by surface tone and by which edge the block sits against.
 *
 * @param props - Author, body, and the streaming flag.
 * @returns The message block.
 * @example
 * <MessageBubble role="user" text="Slogans sur le sucre" />
 */
export const MessageBubble: FC<MessageBubbleProps> = ({
	role,
	text,
	isStreaming = false,
}) => (
	<VStack
		gap="xs"
		align="start"
		id={isStreaming ? "message-streaming" : undefined}
		className={`message-bubble message-bubble--${role}${isStreaming ? " message-bubble--streaming" : ""}`}
	>
		<Text size="xs" weight="medium" as="span" className="message-bubble__author">
			{role === "user" ? "Vous" : "Assistant"}
		</Text>
		<Text
			size="sm"
			tone={role === "user" ? "ondark" : "base"}
			as="span"
			className="message-bubble__body"
		>
			{text}
		</Text>
	</VStack>
)