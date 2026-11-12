/**
 * Agent sources: the records the conversational retrieval agent consulted.
 *
 * One shape serves two consumers. The tools return an {@link AgentSource} to the model, and the
 * browser renders the same shape under the answer. The collector reads the UI message stream on the
 * client side and is pure, so a test proves it without a browser.
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

/** Compare two record identifiers in ascending order. */
const compareId = (left: number | string, right: number | string): number => {
	if (typeof left === "number" && typeof right === "number") {
		return left - right;
	}

	return String(left).localeCompare(String(right), undefined, { numeric: true });
};

/**
 * Read a UI message part as the shape that carries agent sources.
 *
 * The UI message part union is generic, so the two tool part types are read through a minimal
 * structural type. The runtime shape is documented: an `output-available` tool part holds its
 * `output`.
 */
const asSourcePart = (
	part: UIMessage["parts"][number]
): { type: string; state?: string; output?: unknown } =>
	part as { type: string; state?: string; output?: unknown };

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

/**
 * Collect the deduplicated sources from a list of UI messages.
 *
 * It reads the `output-available` parts of `searchRecords` and `fetchNextPage`, ignores every other
 * part, and deduplicates by record identifier. The list is ordered by descending score, then by
 * ascending identifier.
 *
 * @param messages - The UI messages of the conversation.
 * @returns The deduplicated, ordered sources.
 */
export const collectSources = (messages: UIMessage[]): AgentSource[] => {
	const byId = new Map<number | string, AgentSource>();

	for (const message of messages) {
		for (const rawPart of message.parts) {
			const part = asSourcePart(rawPart);

			if (part.type !== "tool-searchRecords" && part.type !== "tool-fetchNextPage") {
				continue;
			}

			if (part.state !== "output-available") {
				continue;
			}

			const results = readResults(part.output);

			if (results === undefined) {
				continue;
			}

			for (const entry of results) {
				const existing = byId.get(entry.id);

				if (existing === undefined || entry.score > existing.score) {
					byId.set(entry.id, entry);
				}
			}
		}
	}

	return [...byId.values()].sort(
		(left, right) => right.score - left.score || compareId(left.id, right.id)
	);
};
