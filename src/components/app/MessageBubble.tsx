import type { FC } from "react";

import { VStack } from "../layout/VStack";
import { Text } from "../base/Text";
import type { TurnStatus } from "../../server/agent/turn-status";
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
	/** Turn state to show while the answer is being built. @defaultValue none (unset) */
	status?: TurnStatus;
}

/** Read the French label of an in-flight turn state, or `undefined` when the answer renders. */
const readStatusLabel = (status: TurnStatus | undefined): string | undefined => {
	if (status === "thinking") {
		return "Réflexion…";
	}

	if (status === "fetching") {
		return "Récupération des données…";
	}

	if (status === "merging") {
		return "Fusion des résultats…";
	}

	return undefined;
};

/**
 * One chat message, at the same size as the question field. The two roles are distinguished by
 * surface tone and by which edge the block sits against. The assistant body is rendered as Markdown
 * through {@link MarkdownText}; the user body is plain text.
 *
 * While the assistant answer is being built, the optional `status` shows the French turn state
 * instead of the empty body.
 *
 * @example
 * 	<MessageBubble role="user" text="Slogans sur le sucre" />;
 * 	<MessageBubble role="assistant" text="" status="thinking" />;
 *
 * @param props - Author, body, streaming flag, and the optional turn state.
 * @returns The message block.
 */
export const MessageBubble: FC<MessageBubbleProps> = ({
	role,
	text,
	isStreaming = false,
	status
}) => {
	const isAssistant = role === "assistant";
	const statusLabel = isAssistant ? readStatusLabel(status) : undefined;

	return (
		<VStack
			gap="xs"
			align="start"
			className={`message-bubble message-bubble--${role}${isStreaming ? " message-bubble--streaming" : ""}`}
		>
			<Text size="xs" weight="medium" as="span" className="message-bubble__author">
				{isAssistant ? "Assistant" : "Vous"}
			</Text>
			{!isAssistant ? (
				<Text size="sm" tone="ondark" as="span" className="message-bubble__body">
					{text}
				</Text>
			) : statusLabel !== undefined ? (
				<Text size="sm" tone="muted" as="span" className="message-bubble__status">
					{statusLabel}
				</Text>
			) : (
				<MarkdownText text={text} />
			)}
		</VStack>
	);
};
