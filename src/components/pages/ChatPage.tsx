import type { FC } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";

import { Grid } from "../layout/Grid";
import { VStack } from "../layout/VStack";
import { HStack } from "../layout/HStack";
import { Heading } from "../base/Heading";
import { Text } from "../base/Text";
import { Button } from "../ui/Button";
import { ChatPanel } from "../app/ChatPanel";
import { SourcesPanel } from "../app/SourcesPanel";
import type { RetrievalAgentUIMessage } from "../../server/agent/agent";
import { collectTurnActivity } from "../../server/agent/sources";

import "./ChatPage.css";

/** Props of the chat page. */
export interface ChatPageProps {
	/** Extra class for shared rules. @defaultValue none */
	className?: string;
}

/**
 * The single screen: a header, the conversation, and the sources the agent consulted. The page is
 * exactly one viewport tall; the conversation and the source list scroll.
 *
 * The page owns the `useChat` hook, so it derives the turn activity from the messages and can reset
 * the conversation with the "Nouvelle session" button.
 *
 * @example
 * 	<ChatPage />;
 *
 * @param props - Optional extra class.
 * @returns The page composition.
 */
export const ChatPage: FC<ChatPageProps> = ({ className = "" }) => {
	const { messages, status, error, sendMessage, setMessages, stop } =
		useChat<RetrievalAgentUIMessage>({
			transport: new DefaultChatTransport({ api: "/api/chat" })
		});
	const queries = collectTurnActivity(messages);

	return (
		<VStack
			as="main"
			gap="base"
			padding="base"
			id="page"
			className={`chat-page ${className}`.trim()}
		>
			<VStack as="header" gap="xs" id="page-header">
				<HStack gap="base" align="center" justify="between" wrap>
					<Heading level={1} size="xl">
						Recherche de slogans
					</Heading>
					<Button variant="secondary" onClick={() => setMessages([])}>
						Nouvelle session
					</Button>
				</HStack>
				<Text size="sm" tone="muted" as="span" id="page-header-meta">
					Recherche hybride dense + BM25, réponses par un LLM.
				</Text>
			</VStack>

			<Grid columns="split" gap="base" id="page-columns">
				<ChatPanel
					messages={messages}
					status={status}
					error={error}
					onSend={(question) => void sendMessage({ text: question })}
					onStop={stop}
				/>
				<SourcesPanel queries={queries} />
			</Grid>
		</VStack>
	);
};
