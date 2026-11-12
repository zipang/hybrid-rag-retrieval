import { describe, expect, test } from "bun:test";
import { StaleGenerationError, SyntaxNotReadyError } from "../lib/index-state";
import type { WeightedHit, WeightedQuery, WeightedResultPage } from "../lib/retrieval-contract";
import {
	CursorExpiredError,
	CursorMismatchError,
	SnapshotCapacityError
} from "../lib/result-pages";
import { ParserUnavailableError } from "../lib/syntax/parser";
import { ApiError, createSlogansHandler, type SloganFields } from "./api";

/** Payload field names used by the handler under test. */
const FIELDS: SloganFields = {
	year: "annee",
	brand: "marque",
	campaign: "campagne",
	content: "slogan"
};

/** One weighted hit with the slogan payload. */
const HIT: WeightedHit = {
	id: 2,
	score: 0.5,
	scores: { syntax: 0, semantic: 0.5, keyword: 0 },
	payload: { annee: 2004, marque: "Danone", campagne: "C1", slogan: "Un peu de sucre" }
};

/** Scoring metadata returned by the fake retriever. */
const METADATA = {
	weights: { syntax: 0, semantic: 1, keyword: 0 },
	minScore: 0,
	normalizationVersion: "1",
	generation: "gen-1"
};

/** One weighted result page. */
const PAGE: WeightedResultPage = { results: [HIT], metadata: METADATA };

/** Build a request URL from query parameters. */
const url = (params: Record<string, string>): string =>
	`http://localhost/api/slogans?${new URLSearchParams(params)}`;

/** Create the handler with a retriever that records each call. */
const createTestHandler = (retrieve: (query: WeightedQuery) => Promise<WeightedResultPage>) =>
	createSlogansHandler({ retriever: { retrieveWeighted: retrieve }, fields: FIELDS });

/** A valid parameter set. */
const VALID = {
	q: "sucre",
	weights: JSON.stringify({ semantic: 1 }),
	minScore: "0"
};

describe("createSlogansHandler (weighted)", () => {
	test("returns typed results, the next cursor, and metadata with CORS headers", async () => {
		const calls: WeightedQuery[] = [];
		const handler = createTestHandler(async (query) => {
			calls.push(query);

			return { results: [HIT], nextCursor: "next-token", metadata: METADATA };
		});

		const response = await handler(new Request(url({ ...VALID, pageSize: "2" })));

		expect(response.status).toBe(200);
		expect(response.headers.get("access-control-allow-origin")).toBe("*");
		expect(await response.json()).toEqual({
			results: [
				{
					id: 2,
					score: 0.5,
					scores: { syntax: 0, semantic: 0.5, keyword: 0 },
					annee: 2004,
					marque: "Danone",
					campagne: "C1",
					slogan: "Un peu de sucre"
				}
			],
			nextCursor: "next-token",
			metadata: METADATA
		});
		expect(calls).toEqual([
			{
				text: "sucre",
				weights: { semantic: 1 },
				minScore: 0,
				pageSize: 2,
				limit: 50
			}
		]);
	});

	test("passes the cursor to the retriever", async () => {
		const calls: WeightedQuery[] = [];
		const handler = createTestHandler(async (query) => {
			calls.push(query);

			return PAGE;
		});

		await handler(new Request(url({ ...VALID, cursor: "abc" })));

		expect(calls[0]?.cursor).toBe("abc");
	});

	test("forwards the optional limit parameter", async () => {
		const calls: WeightedQuery[] = [];
		const handler = createTestHandler(async (query) => {
			calls.push(query);

			return PAGE;
		});

		await handler(new Request(url({ ...VALID, limit: "25" })));

		expect(calls[0]?.limit).toBe(25);
	});

	test("clamps the limit into [1, 1000]", async () => {
		const calls: WeightedQuery[] = [];
		const handler = createTestHandler(async (query) => {
			calls.push(query);

			return PAGE;
		});

		await handler(new Request(url({ ...VALID, limit: "0" })));
		await handler(new Request(url({ ...VALID, limit: "5000" })));

		expect(calls.map((call) => call.limit)).toEqual([1, 1000]);
	});

	test("defaults the limit to 50 when the parameter is absent", async () => {
		const calls: WeightedQuery[] = [];
		const handler = createTestHandler(async (query) => {
			calls.push(query);

			return PAGE;
		});

		await handler(new Request(url(VALID)));

		expect(calls[0]?.limit).toBe(50);
	});

	test("rejects a non-integer limit with 400", async () => {
		const handler = createTestHandler(async () => PAGE);

		for (const limit of ["many", "2.5"]) {
			const response = await handler(new Request(url({ ...VALID, limit })));

			expect(response.status).toBe(400);
			expect(await response.json()).toEqual({
				error: 'Query parameter "limit" must be an integer.'
			});
		}
	});

	test("omits the next cursor on the last page", async () => {
		const handler = createTestHandler(async () => PAGE);
		const response = await handler(new Request(url(VALID)));

		expect(await response.json()).not.toHaveProperty("nextCursor");
	});

	test("rejects an empty query with 400", async () => {
		const handler = createTestHandler(async () => PAGE);

		for (const path of [
			"/api/slogans",
			"/api/slogans?q=",
			"/api/slogans?q=%20%20",
			url({ q: "  ", weights: VALID.weights, minScore: "0" })
		]) {
			const response = await handler(new Request(`http://localhost${path}`));

			expect(response.status).toBe(400);
			expect(await response.json()).toEqual({
				error: 'Query parameter "q" is required.'
			});
		}
	});

	test("rejects each obsolete parameter with 400", async () => {
		const handler = createTestHandler(async () => PAGE);

		for (const name of ["topK", "mode", "yearFrom", "yearTo"]) {
			const response = await handler(new Request(url({ ...VALID, [name]: "1" })));

			expect(response.status).toBe(400);
			expect(await response.json()).toEqual({
				error: `Query parameter "${name}" is obsolete and no longer accepted.`
			});
		}
	});

	test("rejects a missing or non-JSON weights value with 400", async () => {
		const handler = createTestHandler(async () => PAGE);

		const missing = await handler(new Request(url({ q: "sucre", minScore: "0" })));

		expect(missing.status).toBe(400);
		expect(await missing.json()).toEqual({
			error: 'Query parameter "weights" is required.'
		});

		for (const weights of ["not-json", "[1,2]", '"text"', "null"]) {
			const response = await handler(new Request(url({ ...VALID, weights })));

			expect(response.status).toBe(400);
			expect(await response.json()).toEqual({
				error: 'Query parameter "weights" must be a JSON object.'
			});
		}
	});

	test("rejects an invalid weight object with 400 and never normalizes it", async () => {
		const calls: WeightedQuery[] = [];
		const handler = createTestHandler(async (query) => {
			calls.push(query);

			return PAGE;
		});

		for (const weights of [
			JSON.stringify({ semantic: 0.5 }),
			JSON.stringify({ unknown: 1 }),
			JSON.stringify({ semantic: -1, keyword: 2 }),
			JSON.stringify({ semantic: 0 })
		]) {
			const response = await handler(new Request(url({ ...VALID, weights })));

			expect(response.status).toBe(400);
			const body = (await response.json()) as { error: string };

			expect(body.error.startsWith('Query parameter "weights" is invalid:')).toBe(true);
		}

		expect(calls).toEqual([]);
	});

	test("rejects a missing or out-of-range minScore with 400", async () => {
		const handler = createTestHandler(async () => PAGE);

		const missing = await handler(new Request(url({ q: "sucre", weights: VALID.weights })));

		expect(missing.status).toBe(400);
		expect(await missing.json()).toEqual({
			error: 'Query parameter "minScore" is required.'
		});

		for (const minScore of ["2", "-0.1", "abc", "Infinity"]) {
			const response = await handler(new Request(url({ ...VALID, minScore })));

			expect(response.status).toBe(400);
			expect(await response.json()).toEqual({
				error: 'Query parameter "minScore" must be a finite number in [0, 1].'
			});
		}
	});

	test("rejects an invalid pageSize with 400", async () => {
		const handler = createTestHandler(async () => PAGE);

		for (const pageSize of ["0", "-1", "2.5", "many"]) {
			const response = await handler(new Request(url({ ...VALID, pageSize })));

			expect(response.status).toBe(400);
			expect(await response.json()).toEqual({
				error: 'Query parameter "pageSize" must be a positive integer.'
			});
		}
	});

	test("maps each thrown error to the documented status", async () => {
		const cases: Array<{ error: Error; status: number }> = [
			{ error: new ApiError(400, "bad request"), status: 400 },
			{ error: new CursorMismatchError(), status: 400 },
			{ error: new SnapshotCapacityError(128), status: 503 },
			{ error: new StaleGenerationError("a", "b"), status: 409 },
			{ error: new CursorExpiredError(), status: 410 },
			{ error: new SyntaxNotReadyError("gen-1", "missing"), status: 503 },
			{ error: new ParserUnavailableError("no model"), status: 503 },
			{ error: new Error("qdrant is down"), status: 500 }
		];

		for (const { error, status } of cases) {
			const handler = createTestHandler(async () => {
				throw error;
			});
			const response = await handler(new Request(url(VALID)));

			expect(response.status).toBe(status);
			expect(await response.json()).toEqual({ error: error.message });
		}
	});

	test("rejects a non-GET method with 405", async () => {
		const handler = createTestHandler(async () => PAGE);
		const response = await handler(
			new Request(url(VALID), {
				method: "POST"
			})
		);

		expect(response.status).toBe(405);
	});

	test("answers a preflight request with 204", async () => {
		const handler = createTestHandler(async () => PAGE);
		const response = await handler(
			new Request("http://localhost/api/slogans", { method: "OPTIONS" })
		);

		expect(response.status).toBe(204);
		expect(response.headers.get("access-control-allow-origin")).toBe("*");
	});
});
