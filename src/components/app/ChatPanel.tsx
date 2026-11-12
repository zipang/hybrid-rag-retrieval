import { type FC, type FormEvent, useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";

import { VStack } from "../layout/VStack";
import { Heading } from "../base/Heading";
import { Text } from "../base/Text";
import { Button } from "../ui/Button";
import { Panel } from "../ui/Panel";
import { TextArea } from "../ui/TextArea";
import { collectSources } from "../../server/agent/sources";
import type { RetrievalAgentUIMessage } from "../../server/agent/agent";
import { MessageBubble } from "./MessageBubble";
import { SourcesPanel } from "./SourcesPanel";
import { ToolActivity } from "./ToolActivity";

import "./ChatPanel.css";

/** One part of an agent UI message. */
type AgentMessagePart = RetrievalAgentUIMessage["parts"][number];

/** Test whether a part carries answer text. */
const isTextPart = (part: AgentMessagePart): part is Extract<AgentMessagePart, { type: "text" }> =>
	part.type === "text";

/** Test whether a part is one of the two retrieval tool calls. */
const isToolPart = (
	part: AgentMessagePart
): part is Extract<AgentMessagePart, { type: "tool-searchRecords" | "tool-fetchNextPage" }> =>
	part.type === "tool-searchRecords" || part.type === "tool-fetchNextPage";

/** Read the visible text of one message. */
const readText = (message: RetrievalAgentUIMessage): string =>
	message.parts
		.filter(isTextPart)
		.map((part) => part.text)
		.join("");

/** Props of the chat panel. */
export interface ChatPanelProps {
	/** Reports each new question so the retrieval panel can search for it. */
	onQuestionAsked?: (question: string) => void;
}

/**
 * Owns the conversation and the in-flight request. The panel fills the height it is given: the
 * message list scrolls, the composer sits in the footer.
 *
 * The hook reads the UI message stream from `POST /api/chat`. The assistant body is rendered as
 * Markdown, and the records the agent consulted are shown under the answer.
 *
 * @example
 * 	<ChatPanel onQuestionAsked={setQuestion} />;
 *
 * @param props - Optional callback receiving each new question.
 * @returns The scrolling message list and the question field.
 */
export const ChatPanel: FC<ChatPanelProps> = ({ onQuestionAsked }) => {
	const [draft, setDraft] = useState("");
	const listRef = useRef<HTMLDivElement | null>(null);
	const { messages, status, error, sendMessage, stop } = useChat<RetrievalAgentUIMessage>({
		transport: new DefaultChatTransport({ api: "/api/chat" })
	});
	const isBusy = status === "submitted" || status === "streaming";
	const sources = collectSources(messages);
	const lastMessageId = messages.at(-1)?.id;

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
		onQuestionAsked?.(question);
		void sendMessage({ text: question });
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
						{messages.map((message) => (
							<VStack key={message.id} gap="xs">
								{(message.role === "user" || message.role === "assistant") &&
									readText(message) !== "" && (
										<MessageBubble
											role={message.role}
											text={readText(message)}
											isStreaming={
												status === "streaming" &&
												message.id === lastMessageId
											}
										/>
									)}
								{message.parts
									.filter(isToolPart)
									.map((part, index) =>
										part.state === "input-available" ? (
											<ToolActivity
												key={`${message.id}-tool-${index}`}
												tool={part.type.slice(5)}
											/>
										) : null
									)}
							</VStack>
						))}
						<SourcesPanel sources={sources} />
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
						<Button variant="secondary" onClick={stop}>
							Arrêter
						</Button>
					)}
				</VStack>
			</VStack>
		</Panel>
	);
};
