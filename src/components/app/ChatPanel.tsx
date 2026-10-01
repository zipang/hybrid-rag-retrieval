import {
	type FormEvent,
	type FC,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react"

import { VStack } from "../layout/VStack"
import { Heading } from "../base/Heading"
import { Text } from "../base/Text"
import { Panel } from "../ui/Panel"
import { TextArea } from "../ui/TextArea"
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
	onQuestionAsked?: (question: string) => void;
}

/**
 * Owns the conversation and the in-flight request. The panel fills the height
 * it is given: the message list scrolls, the composer sits in the footer.
 *
 * @param props - Optional callback receiving each new question.
 * @returns The scrolling message list and the question field.
 * @example
 * <ChatPanel onQuestionAsked={setQuestion} />
 */
export const ChatPanel: FC<ChatPanelProps> = ({ onQuestionAsked }) => {
	const [turns, setTurns] = useState<ChatTurn[]>([])
	const [draft, setDraft] = useState("")
	const [streamingAnswer, setStreamingAnswer] = useState("")
	const [error, setError] = useState("")
	const [isAnswering, setIsAnswering] = useState(false)
	const listRef = useRef<HTMLDivElement | null>(null)

	// Keeps the newest text in view while the answer streams in.
	useEffect(() => {
		const list = listRef.current

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

			// Close the turn and clear the live buffer so the answer is not
			// rendered twice.
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

	const send = useCallback(() => {
		const question = draft.trim()

		// Ignore empty questions, and re-entry while an answer is streaming.
		if (question === "" || isAnswering) {
			return
		}

		const history: ChatTurn[] = [...turns, { role: "user", content: question }]

		setTurns(history)
		setDraft("")
		onQuestionAsked?.(question)
		void ask(history)
	}, [ask, draft, isAnswering, onQuestionAsked, turns])

	const isEmpty = turns.length === 0 && streamingAnswer === ""

	return (
		<Panel as="section" gap="sm" padding="md" id="chat-panel">
			<Heading level={2} size="lg">
				Conversation
			</Heading>

			{/* min-height:0 lets this child shrink and scroll inside the panel. */}
			<VStack gap="md" id="chat-panel-messages" ref={listRef}>
				{isEmpty ? (
					<Text size="sm" tone="muted">
						Posez une question, par exemple : slogans sur le sucre.
					</Text>
				) : (
					<VStack gap="sm" id="chat-panel-turns">
						{turns.map((turn, index) => (
							<MessageBubble
								// The conversation is append-only, so the index is
								// the only stable identity available.
								key={`${turn.role}-${index}`}
								role={turn.role}
								text={turn.content}
							/>
						))}
						{streamingAnswer !== "" && (
							<MessageBubble role="assistant" text={streamingAnswer} isStreaming />
						)}
					</VStack>
				)}
			</VStack>

			{error !== "" && (
				<Text size="sm" role="alert" className="chat-panel__error" id="chat-panel-error">
					Erreur : {error}
				</Text>
			)}

			<VStack as="footer" gap="sm" className="chat-panel__footer" id="chat-panel-footer">
				<VStack
					as="form"
					gap="sm"
					id="chat-panel-composer"
					// Keeps the form usable if Enter is pressed outside the field.
					onSubmit={(event: FormEvent<HTMLElement>) => {
						event.preventDefault()
						send()
					}}
				>
					<TextArea
						label="Votre question"
						value={draft}
						onValueChange={setDraft}
						onSubmit={send}
						placeholder="Slogans sur le sucre"
						disabled={isAnswering}
					/>
					<Text size="xs" tone="muted" as="span" id="chat-panel-hint">
						Entrée pour envoyer, Maj+Entrée pour une nouvelle ligne.
					</Text>
				</VStack>
			</VStack>
		</Panel>
	)
}