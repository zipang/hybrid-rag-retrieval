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
	/** Extra class for shared rules. @defaultValue none */
	className?: string;
}

/**
 * The single screen: a header, the conversation, and the ranked slogans beside
 * it. The page is exactly one viewport tall; the conversation scrolls.
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
		<VStack
			as="main"
			gap="base"
			padding="base"
			id="page"
			className={`chat-page ${className}`.trim()}
		>
			<VStack as="header" gap="xs" id="page-header">
				<Heading level={1} size="xl">
					Recherche de slogans
				</Heading>
				<HStack gap="base" align="center" wrap id="page-header-meta">
					<Text size="sm" tone="muted" as="span">
						Recherche hybride dense + BM25, réponses par un LLM.
					</Text>
					<HStack gap="xs" align="center" as="label" id="page-toggle">
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

			<Grid columns="split" gap="base" id="page-columns">
				<ChatPanel onQuestionAsked={setQuestion} />
				<RetrievalPanel query={question} isVisible={isRetrievalVisible} />
			</Grid>
		</VStack>
	)
}