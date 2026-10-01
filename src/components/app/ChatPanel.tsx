import { type FormEvent, type FC, useCallback, useEffect, useState } from "react"

import { VStack } from "../layout/VStack"
import { HStack } from "../layout/HStack"
import { Heading } from "../base/Heading"
import { Text } from "../base/Text"
import { Button } from "../ui/Button"
import { Panel } from "../ui/Panel"
import { TextField } from "../ui/TextField"
import { MessageBubble } from "./MessageBubble"

import "./ChatPanel.css"

/** One turn of the conversation, as sent to and returned by the API. */
type ChatTurn = {
	role: "user" | "assistant"
	content: string
}

/** Props of the chat panel. */
export interface ChatPanelProps {
	/** Reports each new question so the retrieval panel can search for it. */
	onQuestionAsked?: (question: string) => void
}

/**
 * Owns the conversation and the in-flight request. It posts to `/api/chat`,
 * shows the answer as it streams in, and keeps the history it sends back.
 *
 * @param props - Optional callback receiving each new question.
 * @returns The message list and the composer.
 * @example
 * <ChatPanel onQuestionAsked={setQuestion} />
 */
export const ChatPanel: FC<ChatPanelProps> = ({ onQuestionAsked }) => {
	const [turns, setTurns] = useState<ChatTurn[]>([])
	const [draft, setDraft] = useState("")
	const [streamingAnswer, setStreamingAnswer] = useState("")
	const [error, setError] = useState("")
	const [isAnswering, setIsAnswering] = useState(false)

	// Follows the newest text as the answer streams in.
	useEffect(() => {
		const list = document.querySelector(".chat-panel__turns")

		if (list) {
			list.scrollTop = list.scrollHeight
		}
	}, [turns, streamingAnswer])

	const ask = useCallback(async (history: ChatTurn[]) => {
		setStreamingAnswer("")
		setError("")
		setIsAnswering(true)

		try {
			const response = await fetch("/api/chat", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					messages: history.map(({ role, content }) => ({
						role,
						parts: [{ type: "text", text: content }],
					})),
				}),
			})

			if (!response.ok || response.body === null) {
				const detail = (await response.json().catch(() => ({}))) as { error?: string }
				throw new Error(detail.error ?? `HTTP ${response.status}`)
			}

			const reader = response.body.getReader()
			const decoder = new TextDecoder()
			let received = ""

			for (;;) {
				const chunk = await reader.read()

				if (chunk.done) {
					break
				}

				received += decoder.decode(chunk.value, { stream: true })
				setStreamingAnswer(received)
			}

			// Flush the decoder, then close the turn and clear the live buffer so
			// the answer is not rendered twice.
			received += decoder.decode()
			setStreamingAnswer("")
			setTurns((current) => [...current, { role: "assistant", content: received }])
		} catch (cause) {
			setStreamingAnswer("")
			setError(cause instanceof Error ? cause.message : "La requête a échoué.")
		} finally {
			setIsAnswering(false)
		}
	}, [])

	const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()

		const question = draft.trim()

		// Ignore empty submissions, and re-entry while an answer is streaming.
		if (question === "" || isAnswering) {
			return
		}

		const history: ChatTurn[] = [...turns, { role: "user", content: question }]

		setTurns(history)
		setDraft("")
		onQuestionAsked?.(question)
		void ask(history)
	}

	const isEmpty = turns.length === 0 && streamingAnswer === ""

	return (
		<Panel as="section" gap="base" className="chat-panel">
			<Heading level={2} size="lg">
				Conversation
			</Heading>

			<VStack gap="base" className="chat-panel__list">
				{isEmpty ? (
					<Text size="sm" tone="muted">
						Posez une question, par exemple : slogans sur le sucre.
					</Text>
				) : (
					<VStack gap="md" className="chat-panel__turns" style={{ overflowY: "auto" }}>
						{turns.map((turn, index) => (
							<MessageBubble
								// The index is the only stable identity here: the
								// conversation is append-only.
								key={`${turn.role}-${index}`}
								role={turn.role}
								text={turn.content}
							/>
						))}
						{streamingAnswer !== "" && (
							<MessageBubble
								role="assistant"
								text={streamingAnswer}
								isStreaming
							/>
						)}
					</VStack>
				)}
			</VStack>

			{error !== "" && (
				<Text size="sm" role="alert" className="chat-panel__error">
					Erreur : {error}
				</Text>
			)}

			<VStack as="form" gap="sm" className="chat-panel__composer" onSubmit={handleSubmit}>
				<HStack gap="sm" align="end">
					<TextField
						label="Votre question"
						name="question"
						value={draft}
						onValueChange={setDraft}
						placeholder="Slogans sur le sucre"
						disabled={isAnswering}
					/>
					<Button type="submit" disabled={isAnswering || draft.trim() === ""}>
						{isAnswering ? "Réponse…" : "Envoyer"}
					</Button>
				</HStack>
			</VStack>
		</Panel>
	)
}