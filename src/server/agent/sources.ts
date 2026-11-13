/**
 * Agent sources: the records the conversational retrieval agent consulted.
 *
 * One shape serves two consumers. The tools return an {@link AgentSource} to the model, and the
 * sources panel renders the same shape grouped by the tool call that returned it. The collector
 * reads the UI message stream on the client side and is pure, so a test proves it without a
 * browser.
 */

import type { UIMessage } from "ai";
import type { WeightedHit } from "../../lib/retrieval-contract";
import type { SloganFields } from "../api";

/** One record that the agent consulted and may cite. */
export type AgentSource = {
	/** Record identifier. */
	id: number | string;
	/** Publication year. */
	annee: number;
	/** Brand or issuing organization. */
	marque: string;
	/** Campaign name. */
	campagne: string;
	/** Slogan text. */
	slogan: string;
	/** Combined weighted score, as returned by `retrieveWeighted`. */
	score: number;
};

/** Read one payload value as a finite number, defaulting to `0`. */
const readNumber = (value: unknown): number => {
	const parsed = typeof value === "number" ? value : Number(value ?? 0);

	return Number.isFinite(parsed) ? parsed : 0;
};

/** Read one payload value as a string. */
const readString = (value: unknown): string => {
	if (typeof value === "string") {
		return value;
	}

	return value === undefined || value === null ? "" : String(value);
};

/** Map one weighted hit to an agent source through the slogan field names. */
export const toAgentSource = (hit: WeightedHit, fields: SloganFields): AgentSource => ({
	id: hit.id,
	annee: readNumber(hit.payload[fields.year]),
	marque: readString(hit.payload[fields.brand]),
	campagne: readString(hit.payload[fields.campaign]),
	slogan: readString(hit.payload[fields.content]),
	score: hit.score
});

/**
 * Read a UI message part as the shape that carries agent sources.
 *
 * The UI message part union is generic, so the two tool part types are read through a minimal
 * structural type. The runtime shape is documented: an `output-available` tool part holds its
 * `output`, and a tool part holds its `input`.
 */
const asSourcePart = (
	part: UIMessage["parts"][number]
): { type: string; state?: string; input?: unknown; output?: unknown } =>
	part as { type: string; state?: string; input?: unknown; output?: unknown };

/**
 * Narrow a tool part output to a successful page of sources.
 *
 * An error output carries an `error` field instead of `results`, so it is ignored. The guard keeps
 * the collector total: an unexpected shape yields no source rather than a throw.
 */
const readResults = (output: unknown): AgentSource[] | undefined => {
	if (typeof output !== "object" || output === null || !("results" in output)) {
		return undefined;
	}

	const results = (output as { results?: unknown }).results;

	return Array.isArray(results) ? (results as AgentSource[]) : undefined;
};

/** One tool call the agent ran in the current turn. */
export type TurnQuery = {
	/** Tool that ran. */
	tool: "searchRecords" | "fetchNextPage";
	/** Search text for `searchRecords`; an empty string for `fetchNextPage`. */
	query: string;
	/** Sources the call returned, in the order the tool returned them. */
	sources: AgentSource[];
};

/** Read the trimmed search text of a `searchRecords` input, or an empty string. */
const readQuery = (input: unknown): string => {
	if (typeof input !== "object" || input === null) {
		return "";
	}

	const query = (input as { query?: unknown }).query;

	return typeof query === "string" ? query.trim() : "";
};

/**
 * Collect the tool activity of the last turn.
 *
 * It reads only the parts that follow the last `user` message. Each `output-available` part of
 * `searchRecords` or `fetchNextPage` becomes one {@link TurnQuery}, in message order. An error
 * output is skipped, and the sources keep the order the tool returned them.
 *
 * @param messages - The UI messages of the conversation.
 * @returns The tool calls of the last turn, or an empty list.
 */
export const collectTurnActivity = (messages: UIMessage[]): TurnQuery[] => {
	const lastUserIndex = messages.findLastIndex((message) => message.role === "user");

	if (lastUserIndex === -1) {
		return [];
	}

	const queries: TurnQuery[] = [];

	for (const message of messages.slice(lastUserIndex + 1)) {
		for (const rawPart of message.parts) {
			const part = asSourcePart(rawPart);

			if (part.type !== "tool-searchRecords" && part.type !== "tool-fetchNextPage") {
				continue;
			}

			if (part.state !== "output-available") {
				continue;
			}

			const sources = readResults(part.output);

			if (sources === undefined) {
				continue;
			}

			queries.push({
				tool: part.type === "tool-searchRecords" ? "searchRecords" : "fetchNextPage",
				query: part.type === "tool-searchRecords" ? readQuery(part.input) : "",
				sources
			});
		}
	}

	return queries;
};
