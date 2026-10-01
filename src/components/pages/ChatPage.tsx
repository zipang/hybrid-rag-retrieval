import { type FC, useState } from "react"

import { Grid } from "../layout/Grid"
import { VStack } from "../layout/VStack"
import { HStack } from "../layout/HStack"
import { Heading } from "../base/Heading"
import { Text } from "../base/Text"
import { ChatPanel } from "../app/ChatPanel"
import { RetrievalPanel } from "../app/RetrievalPanel"

import "./ChatPage.css"

/** Props of the chat page. */
export interface ChatPageProps {
	/** Extra class for the component's own rules. @defaultValue none */
	className?: string;
}

/**
 * The single screen: a header, the conversation, and the ranked slogans beside
 * it. The two columns stack on a narrow viewport.
 *
 * @param props - Optional extra class.
 * @returns The page composition.
 * @example
 * <ChatPage />
 */
export const ChatPage: FC<ChatPageProps> = ({ className = "" }) => {
	const [question, setQuestion] = useState("")
	const [isRetrievalVisible, setIsRetrievalVisible] = useState(true)

	return (
		<VStack gap="lg" padding="lg" as="main" className={`chat-page ${className}`.trim()}>
			<VStack as="header" gap="xs" className="chat-page__header">
				<Heading level={1}>Recherche de slogans</Heading>
				<HStack gap="base" align="center" wrap>
					<Text size="sm" tone="muted">
						Recherche hybride dense + BM25, réponses par un LLM.
					</Text>
					<HStack gap="xs" align="center" as="label" className="chat-page__toggle">
						<input
							type="checkbox"
							checked={isRetrievalVisible}
							onChange={(event) => setIsRetrievalVisible(event.target.checked)}
						/>
						<Text size="xs" tone="muted" as="span">
							Afficher les résultats de recherche
						</Text>
					</HStack>
				</HStack>
			</VStack>

			<Grid columns="split" gap="lg" className="chat-page__columns">
				<ChatPanel onQuestionAsked={setQuestion} />
				<RetrievalPanel query={question} isVisible={isRetrievalVisible} />
			</Grid>
		</VStack>
	)
}