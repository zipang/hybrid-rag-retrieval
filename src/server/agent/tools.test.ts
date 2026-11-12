import { describe, expect, test } from "bun:test";
import type {
	IndexWeights,
	WeightedHit,
	WeightedQuery,
	WeightedResultPage
} from "../../lib/retrieval-contract";
import type { SloganFields } from "../api";
import type { CachedSearch, SearchSessionStore } from "./session-store";
import {
	createFetchNextPageTool,
	createSearchRecordsTool,
	fetchNextPage,
	searchRecords,
	type ToolDependencies
} from "./tools";

/** Payload field names used by the tools under test. */
const FIELDS: SloganFields = {
	year: "annee",
	brand: "marque",
	campaign: "campagne",
	content: "slogan"
};

/** Fixed weights the agent applies to every search. */
const WEIGHTS: IndexWeights = { syntax: 0.5, semantic: 0.3, keyword: 0.2 };

/** One weighted hit with the slogan payload. */
const HIT: WeightedHit = {
	id: 2,
	score: 0.5,
	scores: { semantic: 0.5 },
	payload: { annee: 2004, marque: "Danone", campagne: "C1", slogan: "Un peu de sucre" }
};

/** Scoring metadata returned by the fake retriever. */
const METADATA = {
	weights: { syntax: 0.5, semantic: 0.3, keyword: 0.2 },
	minScore: 0.5,
	normalizationVersion: "1",
	generation: "gen-1"
};

/** A fake session store that records each call. */
const createFakeSessions = () => {
	const saved: Array<{ sessionId: string; search: CachedSearch }> = [];
	const updated: Array<{ sessionId: string; token: string; cursor: string | undefined }> = [];
	const table = new Map<string, { sessionId: string; search: CachedSearch }>();

	const sessions: SearchSessionStore = {
		save: (sessionId, search) => {
			saved.push({ sessionId, search });
			const token = `tok-${saved.length}`;
			table.set(token, { sessionId, search });

			return token;
		},
		read: (sessionId, token) => {
			const entry = table.get(token);

			return entry !== undefined && entry.sessionId === sessionId ? entry.search : undefined;
		},
		update: (sessionId, token, cursor) => {
			updated.push({ sessionId, token, cursor });
		}
	};

	return { sessions, saved, updated };
};

/** Create tool dependencies with a fake retriever that records each query. */
const createDependencies = (
	retrieve: (query: WeightedQuery) => Promise<WeightedResultPage>,
	overrides: Partial<ToolDependencies> = {}
) => {
	const queries: WeightedQuery[] = [];
	const fake = createFakeSessions();
	const dependencies: ToolDependencies = {
		retriever: {
			retrieveWeighted: async (query) => {
				queries.push(query);

				return retrieve(query);
			}
		},
		sessions: fake.sessions,
		fields: FIELDS,
		weights: WEIGHTS,
		minScore: 0.5,
		sessionId: "s1",
		...overrides
	};

	return { dependencies, queries, ...fake };
};

/** A page that carries one hit and a continuation cursor. */
const pageWithMore = (): WeightedResultPage => ({
	results: [HIT],
	nextCursor: "retrieval-next",
	metadata: METADATA
});

/** A page that carries one hit and no continuation cursor. */
const lastPage = (): WeightedResultPage => ({ results: [HIT], metadata: METADATA });

describe("searchRecords", () => {
	test("builds the weighted query from the input and the fixed weights", async () => {
		const { dependencies, queries } = createDependencies(async () => lastPage());

		await searchRecords(dependencies, { query: "sucre" });

		expect(queries).toEqual([
			{ text: "sucre", weights: WEIGHTS, minScore: 0.5, pageSize: 5, limit: 50 }
		]);
	});

	test("defaults the candidate limit to 50", async () => {
		const { dependencies, queries } = createDependencies(async () => lastPage());

		await searchRecords(dependencies, { query: "sucre" });

		expect(queries[0]?.limit).toBe(50);
	});

	test("clamps the candidate limit to [1, 1000]", async () => {
		const { dependencies, queries } = createDependencies(async () => lastPage());

		await searchRecords(dependencies, { query: "sucre", limit: 0 });
		await searchRecords(dependencies, { query: "sucre", limit: 5000 });

		expect(queries.map((query) => query.limit)).toEqual([1, 1000]);
	});

	test("passes the candidate limit from the input to the retriever", async () => {
		const { dependencies, queries } = createDependencies(async () => lastPage());

		await searchRecords(dependencies, { query: "sucre", limit: 25 });

		expect(queries[0]?.limit).toBe(25);
	});

	test("clamps the page size to [1, 20]", async () => {
		const { dependencies, queries } = createDependencies(async () => lastPage());

		await searchRecords(dependencies, { query: "sucre", pageSize: 50 });
		await searchRecords(dependencies, { query: "sucre", pageSize: 0 });

		expect(queries.map((query) => query.pageSize)).toEqual([20, 1]);
	});

	test("maps each weighted hit to an agent source", async () => {
		const { dependencies } = createDependencies(async () => lastPage());

		const result = await searchRecords(dependencies, { query: "sucre" });

		expect(result).toEqual({
			results: [
				{
					id: 2,
					annee: 2004,
					marque: "Danone",
					campagne: "C1",
					slogan: "Un peu de sucre",
					score: 0.5
				}
			],
			hasMore: false
		});
	});

	test("stores the binding and returns the store token as the next cursor", async () => {
		const { dependencies, saved } = createDependencies(async () => pageWithMore());

		const result = await searchRecords(dependencies, { query: "sucre", pageSize: 3 });

		expect(result).toEqual({
			results: [
				{
					id: 2,
					annee: 2004,
					marque: "Danone",
					campagne: "C1",
					slogan: "Un peu de sucre",
					score: 0.5
				}
			],
			hasMore: true,
			nextCursor: "tok-1"
		});
		expect(saved).toEqual([
			{
				sessionId: "s1",
				search: {
					binding: { text: "sucre", weights: WEIGHTS, minScore: 0.5, limit: 50 },
					pageSize: 3,
					cursor: "retrieval-next"
				}
			}
		]);
	});

	test("stores the chosen candidate limit in the cached binding", async () => {
		const { dependencies, saved } = createDependencies(async () => pageWithMore());

		await searchRecords(dependencies, { query: "sucre", limit: 25 });

		expect(saved[0]?.search.binding.limit).toBe(25);
	});

	test("returns an empty page for a blank query without calling the retriever", async () => {
		const { dependencies, queries } = createDependencies(async () => lastPage());

		expect(await searchRecords(dependencies, { query: "   " })).toEqual({
			results: [],
			hasMore: false
		});
		expect(queries).toEqual([]);
	});

	test("returns an error object when the retrieval fails, and never throws", async () => {
		const { dependencies } = createDependencies(async () => {
			throw new Error("syntax index is not ready");
		});

		expect(await searchRecords(dependencies, { query: "sucre" })).toEqual({
			error: "syntax index is not ready"
		});
	});
});

describe("fetchNextPage", () => {
	/** A cached search bound to the test session. */
	const cached: CachedSearch = {
		binding: { text: "sucre", weights: WEIGHTS, minScore: 0.5, limit: 25 },
		pageSize: 4,
		cursor: "retrieval-1"
	};

	test("re-supplies the stored binding, cursor, and page size", async () => {
		const { dependencies, queries } = createDependencies(async () => lastPage(), {
			sessions: {
				save: () => "unused",
				read: () => cached,
				update: () => {}
			}
		});

		await fetchNextPage(dependencies, { cursor: "tok-1" });

		expect(queries).toEqual([
			{
				text: "sucre",
				weights: WEIGHTS,
				minScore: 0.5,
				limit: 25,
				pageSize: 4,
				cursor: "retrieval-1"
			}
		]);
	});

	test("re-supplies the candidate limit of the originating search", async () => {
		const { dependencies, queries } = createDependencies(async () => lastPage(), {
			sessions: {
				save: () => "unused",
				read: () => cached,
				update: () => {}
			}
		});

		await fetchNextPage(dependencies, { cursor: "tok-1" });

		expect(queries[0]?.limit).toBe(25);
	});

	test("maps the page and advances the stored cursor", async () => {
		const { dependencies, updated } = createDependencies(async () => pageWithMore(), {
			sessions: {
				save: () => "unused",
				read: () => cached,
				update: (sessionId, token, cursor) => updated.push({ sessionId, token, cursor })
			}
		});

		const result = await fetchNextPage(dependencies, { cursor: "tok-1" });

		expect(result).toEqual({
			results: [
				{
					id: 2,
					annee: 2004,
					marque: "Danone",
					campagne: "C1",
					slogan: "Un peu de sucre",
					score: 0.5
				}
			],
			hasMore: true,
			nextCursor: "tok-1"
		});
		expect(updated).toEqual([{ sessionId: "s1", token: "tok-1", cursor: "retrieval-next" }]);
	});

	test("clears the cursor and reports no more records on the last page", async () => {
		const updated: Array<{ token: string; cursor: string | undefined }> = [];
		const { dependencies } = createDependencies(async () => lastPage(), {
			sessions: {
				save: () => "unused",
				read: () => cached,
				update: (_sessionId, token, cursor) => updated.push({ token, cursor })
			}
		});

		const result = await fetchNextPage(dependencies, { cursor: "tok-1" });

		expect(result).toEqual({
			results: [
				{
					id: 2,
					annee: 2004,
					marque: "Danone",
					campagne: "C1",
					slogan: "Un peu de sucre",
					score: 0.5
				}
			],
			hasMore: false
		});
		expect(updated).toEqual([{ token: "tok-1", cursor: undefined }]);
	});

	test("returns an error for an unknown or foreign token", async () => {
		const { dependencies } = createDependencies(async () => lastPage(), {
			sessions: {
				save: () => "unused",
				read: () => undefined,
				update: () => {}
			}
		});

		const result = await fetchNextPage(dependencies, { cursor: "tok-unknown" });

		expect(result).toEqual({ error: "the cursor is unknown or has expired" });
	});

	test("returns an error for a retrieval failure and never throws", async () => {
		const { dependencies } = createDependencies(
			async () => {
				throw new Error("snapshot has expired");
			},
			{
				sessions: {
					save: () => "unused",
					read: () => cached,
					update: () => {}
				}
			}
		);

		expect(await fetchNextPage(dependencies, { cursor: "tok-1" })).toEqual({
			error: "snapshot has expired"
		});
	});

	test("returns an error when the cached search has no cursor", async () => {
		const { dependencies } = createDependencies(async () => lastPage(), {
			sessions: {
				save: () => "unused",
				read: () => ({ ...cached, cursor: undefined }),
				update: () => {}
			}
		});

		expect(await fetchNextPage(dependencies, { cursor: "tok-1" })).toEqual({
			error: "the cursor is unknown or has expired"
		});
	});
});

describe("tool factories", () => {
	test("build a tool for each operation", () => {
		const { dependencies } = createDependencies(async () => lastPage());

		expect(createSearchRecordsTool(dependencies)).toHaveProperty("execute");
		expect(createFetchNextPageTool(dependencies)).toHaveProperty("execute");
	});
});
