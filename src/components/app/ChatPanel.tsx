import { type FC, type FormEvent, useEffect, useRef, useState } from "react";

import { VStack } from "../layout/VStack";
import { Heading } from "../base/Heading";
import { Text } from "../base/Text";
import { Button } from "../ui/Button";
import { Panel } from "../ui/Panel";
import { TextArea } from "../ui/TextArea";
import type { RetrievalAgentUIMessage } from "../../server/agent/agent";
import { type ChatStatus, readTurnStatus } from "../../server/agent/turn-status";
import { MessageBubble } from "./MessageBubble";

import "./ChatPanel.css";

/** One part of an agent UI message. */
type AgentMessagePart = RetrievalAgentUIMessage["parts"][number];

/** Read the visible text of one message. */
const readText = (message: RetrievalAgentUIMessage): string =>
	message.parts
		.filter((part): part is Extract<AgentMessagePart, { type: "text" }> => part.type === "text")
		.map((part) => part.text)
		.join("");

/** Props of the chat panel. */
export interface ChatPanelProps {
	/** Conversation messages, oldest first. */
	messages: RetrievalAgentUIMessage[];
	/** Status of the in-flight request. */
	status: ChatStatus;
	/** Stream error, when the last turn failed. @defaultValue none (unset) */
	error?: Error;
	/** Sends one question. */
	onSend: (question: string) => void;
	/** Stops the in-flight answer. */
	onStop: () => void;
}

/**
 * The conversation region. The page owns the conversation state, so this panel renders it and keeps
 * only the composer draft locally. The message list scrolls, the composer sits in the footer. While
 * the agent builds its answer, the in-flight assistant bubble shows the turn state.
 *
 * @example
 * 	<ChatPanel messages={messages} status={status} onSend={send} onStop={stop} />;
 *
 * @param props - The conversation state and the two actions.
 * @returns The scrolling message list and the question field.
 */
export const ChatPanel: FC<ChatPanelProps> = ({ messages, status, error, onSend, onStop }) => {
	const [draft, setDraft] = useState("");
	const listRef = useRef<HTMLDivElement | null>(null);
	const isBusy = status === "submitted" || status === "streaming";
	const turnStatus = readTurnStatus(status, messages);
	const lastMessage = messages.at(-1);
	const lastMessageId = lastMessage?.id;

	// Keeps the newest text in view while the answer streams in.
	useEffect(() => {
		const list = listRef.current;

		if (list) {
			list.scrollTop = list.scrollHeight;
		}
	}, [messages]);

	/** Submit the trimmed draft as the next question and clear the field. */
	const send = () => {
		const question = draft.trim();

		// Ignore empty questions, and re-entry while an answer is streaming.
		if (question === "" || isBusy) {
			return;
		}

		setDraft("");
		onSend(question);
	};

	return (
		<Panel as="section" gap="sm" padding="md" id="chat-panel">
			<Heading level={2} size="lg">
				Conversation
			</Heading>

			{/* min-height:0 lets this child shrink and scroll inside the panel. */}
			<VStack gap="md" id="chat-panel-messages" ref={listRef}>
				{messages.length === 0 ? (
					<Text size="sm" tone="muted">
						Posez une question, par exemple : slogans sur le sucre.
					</Text>
				) : (
					<VStack gap="sm" id="chat-panel-turns">
						{messages.map((message) => {
							const text = readText(message);
							const isAssistant = message.role === "assistant";
							const isLast = message.id === lastMessageId;

							// The in-flight turn shows its status before any answer text arrives.
							if (isAssistant && isLast && text === "" && isBusy) {
								return (
									<MessageBubble
										key={message.id}
										role="assistant"
										text=""
										status={turnStatus}
									/>
								);
							}

							if (message.role === "system" || text === "") {
								return null;
							}

							return (
								<MessageBubble
									key={message.id}
									role={message.role}
									text={text}
									isStreaming={status === "streaming" && isLast}
								/>
							);
						})}
						{/* The status bubble appears before the assistant message exists. */}
						{isBusy && lastMessage?.role !== "assistant" && (
							<MessageBubble role="assistant" text="" status={turnStatus} />
						)}
					</VStack>
				)}
			</VStack>

			{error !== undefined && (
				<Text size="sm" role="alert" className="chat-panel__error" id="chat-panel-error">
					Erreur : {error.message}
				</Text>
			)}

			<VStack as="footer" gap="sm" className="chat-panel__footer" id="chat-panel-footer">
				<VStack
					as="form"
					gap="sm"
					// Keeps the form usable if Enter is pressed outside the field.
					onSubmit={(event: FormEvent<HTMLElement>) => {
						event.preventDefault();
						send();
					}}
				>
					<TextArea
						label="Votre question"
						value={draft}
						onValueChange={setDraft}
						onSubmit={send}
						placeholder="Slogans sur le sucre"
						disabled={isBusy}
					/>
					<Text size="xs" tone="muted" as="span" id="chat-panel-hint">
						Entrée pour envoyer, Maj+Entrée pour une nouvelle ligne.
					</Text>
					{isBusy && (
						<Button variant="secondary" onClick={onStop}>
							Arrêter
						</Button>
					)}
				</VStack>
			</VStack>
		</Panel>
	);
};
