/**
 * The two query tools of the conversational retrieval agent.
 *
 * `searchRecords` starts a weighted search and caches its binding, so a conversation can continue
 * the same ranked list. `fetchNextPage` reads the next page of a cached search. Both tools return
 * an error object instead of throwing, so the model can recover or report the failure.
 */

import { jsonSchema, tool } from "ai";
import type { WeightedRetriever } from "../../lib/retrieval";
import type { IndexWeights } from "../../lib/retrieval-contract";
import type { SloganFields } from "../api";
import { type AgentSource, toAgentSource } from "./sources";
import type { SearchSessionStore } from "./session-store";

/** Input of the `searchRecords` tool. */
export type SearchRecordsInput = {
	/** Search text. Required and non-empty after trim. */
	query: string;
	/** Records returned in this first page. Default 5, clamped to [1, 20]. */
	pageSize?: number;
};

/** Output of the `searchRecords` tool. */
export type SearchRecordsOutput =
	| {
			/** First page of the ranked result list. */
			results: AgentSource[];
			/** True when the ranked list holds records beyond this page. */
			hasMore: boolean;
			/** Opaque continuation cursor. Present exactly when `hasMore` is true. */
			nextCursor?: string;
	  }
	| {
			/** Human-readable reason, so the model can recover and search again. */
			error: string;
	  };

/** Input of the `fetchNextPage` tool. */
export type FetchNextPageInput = {
	/** Cursor returned by `searchRecords` or by a previous `fetchNextPage`. */
	cursor: string;
};

/** Output of the `fetchNextPage` tool. */
export type FetchNextPageOutput =
	| {
			/** Next page of the cached ranked list. */
			results: AgentSource[];
			/** True when more records remain. */
			hasMore: boolean;
			/** Opaque continuation cursor. Present exactly when `hasMore` is true. */
			nextCursor?: string;
	  }
	| {
			/** Human-readable reason, so the model can recover and search again. */
			error: string;
	  };

/** Dependencies shared by both query tools. */
export type ToolDependencies = {
	/** Weighted retriever behind the two tools. */
	retriever: Pick<WeightedRetriever, "retrieveWeighted">;
	/** Search session store. */
	sessions: SearchSessionStore;
	/** Payload field names that map one hit to a typed source. */
	fields: SloganFields;
	/** Index weights the agent applies to every search. */
	weights: IndexWeights;
	/** Minimum combined score the agent applies to every search. */
	minScore: number;
	/** Conversation identifier that owns the session store entries. */
	sessionId: string;
};

/** Records returned in a first page when the model does not choose a size. */
const DEFAULT_PAGE_SIZE = 5;

/** Smallest delivery size the tool accepts. */
const MIN_PAGE_SIZE = 1;

/** Largest delivery size the tool accepts. */
const MAX_PAGE_SIZE = 20;

/** The reason both tools give for a cursor they cannot resolve. */
const UNKNOWN_CURSOR = "the cursor is unknown or has expired";

/** Read a thrown value as a human-readable message. */
const toErrorMessage = (error: unknown): string =>
	error instanceof Error ? error.message : "the retrieval request failed";

/** Normalize the requested page size into the accepted range. */
const normalizePageSize = (pageSize?: number): number => {
	if (pageSize === undefined || !Number.isFinite(pageSize)) {
		return DEFAULT_PAGE_SIZE;
	}

	return Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, Math.trunc(pageSize)));
};

/**
 * Run one weighted search and shape the result for the model.
 *
 * A blank query returns an empty page and reads no index. A retrieval failure returns an error
 * object instead of throwing. When the ranked list holds more records, the query binding is cached
 * under an opaque token that the model can pass to `fetchNextPage`.
 *
 * @param dependencies - Retriever, session store, fields, weights, and threshold.
 * @param input - Search text and an optional page size.
 * @returns The first page, or an error object.
 */
export const searchRecords = async (
	dependencies: ToolDependencies,
	input: SearchRecordsInput
): Promise<SearchRecordsOutput> => {
	const query = input.query.trim();

	if (query === "") {
		return { results: [], hasMore: false };
	}

	const pageSize = normalizePageSize(input.pageSize);

	try {
		const page = await dependencies.retriever.retrieveWeighted({
			text: query,
			weights: dependencies.weights,
			minScore: dependencies.minScore,
			pageSize
		});
		const results = page.results.map((hit) => toAgentSource(hit, dependencies.fields));

		if (page.nextCursor === undefined) {
			return { results, hasMore: false };
		}

		const token = dependencies.sessions.save(dependencies.sessionId, {
			binding: {
				text: query,
				weights: dependencies.weights,
				minScore: dependencies.minScore
			},
			pageSize,
			cursor: page.nextCursor
		});

		return { results, hasMore: true, nextCursor: token };
	} catch (error) {
		return { error: toErrorMessage(error) };
	}
};

/**
 * Read the next page of a cached search.
 *
 * The stored binding, retrieval cursor, and page size are re-supplied to the retriever, so the
 * continuation matches the originating query. An unknown, expired, foreign, or exhausted cursor
 * returns an error object instead of throwing, so the model can search again.
 *
 * @param dependencies - Retriever, session store, and fields.
 * @param input - The cursor returned by a previous tool call.
 * @returns The next page, or an error object.
 */
export const fetchNextPage = async (
	dependencies: ToolDependencies,
	input: FetchNextPageInput
): Promise<FetchNextPageOutput> => {
	const cached = dependencies.sessions.read(dependencies.sessionId, input.cursor);

	if (cached === undefined || cached.cursor === undefined) {
		return { error: UNKNOWN_CURSOR };
	}

	try {
		const page = await dependencies.retriever.retrieveWeighted({
			...cached.binding,
			cursor: cached.cursor,
			pageSize: cached.pageSize
		});
		const results = page.results.map((hit) => toAgentSource(hit, dependencies.fields));

		dependencies.sessions.update(dependencies.sessionId, input.cursor, page.nextCursor);

		if (page.nextCursor === undefined) {
			return { results, hasMore: false };
		}

		return { results, hasMore: true, nextCursor: input.cursor };
	} catch (error) {
		return { error: toErrorMessage(error) };
	}
};

/** Create the `searchRecords` tool that starts a weighted search. */
export const createSearchRecordsTool = (dependencies: ToolDependencies) =>
	tool({
		description:
			"Search the slogan corpus with a weighted query. Returns a first page of ranked records and an opaque cursor when more records remain.",
		inputSchema: jsonSchema<SearchRecordsInput>({
			type: "object",
			properties: {
				query: {
					type: "string",
					description: "Search text built from the content words of the question."
				},
				pageSize: {
					type: "number",
					description:
						"Records returned in this first page. Defaults to 5, clamped to [1, 20]."
				}
			},
			required: ["query"],
			additionalProperties: false
		}),
		execute: (input) => searchRecords(dependencies, input)
	});

/** Create the `fetchNextPage` tool that continues a cached search. */
export const createFetchNextPageTool = (dependencies: ToolDependencies) =>
	tool({
		description:
			"Read the next page of a search started by searchRecords. Use only a cursor that a tool returned.",
		inputSchema: jsonSchema<FetchNextPageInput>({
			type: "object",
			properties: {
				cursor: {
					type: "string",
					description: "Cursor returned by searchRecords or by a previous fetchNextPage."
				}
			},
			required: ["cursor"],
			additionalProperties: false
		}),
		execute: (input) => fetchNextPage(dependencies, input)
	});
