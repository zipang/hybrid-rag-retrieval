/**
 * The turn status: the coarse phase of the assistant turn in flight.
 *
 * The browser derives the phase from two client-observable inputs only: the `status` that `useChat`
 * reports, and the parts of the messages. No server progress event is added, so the derivation is
 * pure and a test proves it without a browser.
 */

import type { UIMessage } from "ai";

/** The `status` value that `useChat` reports. */
export type ChatStatus = "submitted" | "streaming" | "ready" | "error";

/** The coarse state of the assistant turn in flight. */
export type TurnStatus = "thinking" | "fetching" | "merging" | "answering";

/** The part shape the derivation reads through a minimal structural type. */
type StatusPart = {
	/** Part type, such as `text` or `tool-searchRecords`. */
	type: string;
	/** Tool part state, when the part is a tool call. */
	state?: string;
	/** Text of a text part. */
	text?: string;
};

/** Read one UI message part as the shape the derivation inspects. */
const asStatusPart = (part: UIMessage["parts"][number]): StatusPart => part as StatusPart;

/** Test whether a message holds a text part with non-empty text. */
const hasAnswerText = (message: UIMessage): boolean =>
	message.parts.some((part) => {
		const candidate = asStatusPart(part);

		return (
			candidate.type === "text" && typeof candidate.text === "string" && candidate.text !== ""
		);
	});

/** Test whether a message holds a tool part in the given state. */
const hasToolPartInState = (message: UIMessage, state: string): boolean =>
	message.parts.some((part) => {
		const candidate = asStatusPart(part);

		return candidate.type.startsWith("tool-") && candidate.state === state;
	});

/**
 * Derive the state of the turn in flight.
 *
 * A submitted request is `thinking`. A ready or failed turn is idle and reports `answering`, so the
 * caller hides the status line. While the response streams, the last message decides the phase:
 * answer text is `answering`, a tool call whose input is ready is `fetching`, and a tool call whose
 * output is ready is `merging`. Anything else is `thinking`.
 *
 * @param status - The `status` that `useChat` reports.
 * @param messages - The UI messages of the conversation.
 * @returns The state of the turn in flight.
 */
export const readTurnStatus = (status: ChatStatus, messages: UIMessage[]): TurnStatus => {
	if (status === "submitted") {
		return "thinking";
	}

	if (status === "ready" || status === "error") {
		return "answering";
	}

	const lastMessage = messages.at(-1);

	if (lastMessage === undefined) {
		return "thinking";
	}

	if (hasAnswerText(lastMessage)) {
		return "answering";
	}

	if (hasToolPartInState(lastMessage, "input-available")) {
		return "fetching";
	}

	if (hasToolPartInState(lastMessage, "output-available")) {
		return "merging";
	}

	return "thinking";
};
