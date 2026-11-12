import { describe, expect, test } from "bun:test";
import type { SyntaxIndexState } from "./index-state";
import { StaleGenerationError, SyntaxNotReadyError } from "./index-state";
import type { ExactAstQuery, ExactDenseQuery, ExactSparseQuery } from "./qdrant";
import { createWeightedRetriever } from "./retrieval";
import { normalizeBm25, normalizeMultivectorMaxSim } from "./scoring";
import type { SyntaxMode } from "./syntax/abstraction";
import { encodeTree } from "./syntax/encoder";
import { type ParsedText, type Parser, ParserUnavailableError } from "./syntax/parser";

/** BM25 options shared by the weighted fakes. */
const BM25 = { language: "french", ascii_folding: true, avg_len: 7 };

/** One valid parsed sentence used by the syntax fakes. */
const SENTENCE: ParsedText["sentences"][number] = [
	["Le", "le", "DET", 2, "det", ""],
	["garçon", "garçon", "NOUN", 3, "nsubj", ""],
	["regarde", "regarder", "VERB", 0, "root", ""],
	["le", "le", "DET", 5, "det", ""],
	["soleil", "soleil", "NOUN", 3, "obj", ""]
];

/** A parsed one-sentence text. */
const ONE_SENTENCE: ParsedText = { sentences: [SENTENCE] };

/** A parsed two-sentence text, so the query row count can differ from a record. */
const TWO_SENTENCES: ParsedText = { sentences: [SENTENCE, SENTENCE] };

/** Create a weighted retriever over fixed identifiers and cosine scores. */
const createWeightedFakes = (
	ids: Array<number | string>,
	cosines: Record<string | number, number>,
	options: { batchSize?: number } = {}
) => {
	const denseQueries: string[] = [];
	const batches: Array<Array<number | string>> = [];
	const scrollCalls: Array<unknown> = [];
	const denseCalls: ExactDenseQuery[] = [];
	const dependencies = {
		embedder: {
			embedDenseQuery: async (text: string) => {
				denseQueries.push(text);

				return [0.1, 0.2];
			}
		},
		client: {
			scrollIds: async (request?: unknown) => {
				scrollCalls.push(request);

				return ids;
			},
			queryDenseExact: async (query: ExactDenseQuery) => {
				batches.push(query.ids);
				denseCalls.push(query);

				return {
					scores: query.ids
						.filter((id) => cosines[id] !== undefined)
						.map((id) => ({ id, score: cosines[id] ?? 0 })),
					missing: []
				};
			},
			querySparseExact: async () => ({ scores: [], missing: [] }),
			queryAstExact: async () => ({ scores: [], missing: [] }),
			fetchPayloads: async (requested: Array<number | string>) =>
				new Map(
					requested.map((id) => [id, { annee: 2005, marque: "Brand", slogan: "Texte" }])
				)
		},
		bm25: BM25,
		idBatchSize: options.batchSize
	};

	return { dependencies, denseQueries, batches, scrollCalls, denseCalls };
};

describe("retrieveWeighted (semantic-only)", () => {
	test("scores every eligible identifier without a top-K cutoff", async () => {
		const ids = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
		const cosines: Record<number, number> = {};
		for (const id of ids) {
			cosines[id] = id / 100;
		}
		const { dependencies } = createWeightedFakes(ids, cosines);
		const retriever = createWeightedRetriever(dependencies);

		const page = await retriever.retrieveWeighted({
			text: "sucre",
			weights: { semantic: 1 },
			minScore: 0,
			pageSize: 100
		});

		expect(page.results).toHaveLength(10);
		expect(page.results[0]).toMatchObject({ id: 10, score: 0.1 });
	});

	test("normalizes cosine and clips negative values to zero", async () => {
		const { dependencies } = createWeightedFakes([1, 2], {
			1: 0.8,
			2: -0.5
		});
		const retriever = createWeightedRetriever(dependencies);

		const page = await retriever.retrieveWeighted({
			text: "sucre",
			weights: { semantic: 1 },
			minScore: 0
		});

		expect(page.results).toEqual([
			{
				id: 1,
				score: 0.8,
				scores: { syntax: 0, semantic: 0.8, keyword: 0 },
				payload: { annee: 2005, marque: "Brand", slogan: "Texte" }
			},
			{
				id: 2,
				score: 0,
				scores: { syntax: 0, semantic: 0, keyword: 0 },
				payload: { annee: 2005, marque: "Brand", slogan: "Texte" }
			}
		]);
	});

	test("applies an inclusive threshold at the boundary", async () => {
		const { dependencies } = createWeightedFakes([1, 2, 3], {
			1: 0.8,
			2: 0.5,
			3: 0.4999999
		});
		const retriever = createWeightedRetriever(dependencies);

		const page = await retriever.retrieveWeighted({
			text: "sucre",
			weights: { semantic: 1 },
			minScore: 0.5
		});

		expect(page.results.map((hit) => hit.id)).toEqual([1, 2]);
	});

	test("returns an empty page when no record qualifies", async () => {
		const { dependencies } = createWeightedFakes([1, 2], {
			1: 0.2,
			2: 0.3
		});
		const retriever = createWeightedRetriever(dependencies);

		const page = await retriever.retrieveWeighted({
			text: "sucre",
			weights: { semantic: 1 },
			minScore: 0.9
		});

		expect(page.results).toEqual([]);
		expect(page.nextCursor).toBeUndefined();
	});

	test("a zero threshold includes zero-score records", async () => {
		const { dependencies } = createWeightedFakes([1, 2], { 1: 0.9, 2: -1 });
		const retriever = createWeightedRetriever(dependencies);

		const page = await retriever.retrieveWeighted({
			text: "sucre",
			weights: { semantic: 1 },
			minScore: 0
		});

		expect(page.results.map((hit) => hit.id)).toEqual([1, 2]);
	});

	test("batches identifier score requests", async () => {
		const ids = [1, 2, 3, 4, 5];
		const cosines: Record<number, number> = {
			1: 0.1,
			2: 0.2,
			3: 0.3,
			4: 0.4,
			5: 0.5
		};
		const { dependencies, batches } = createWeightedFakes(ids, cosines, {
			batchSize: 2
		});
		const retriever = createWeightedRetriever(dependencies);

		await retriever.retrieveWeighted({
			text: "sucre",
			weights: { semantic: 1 },
			minScore: 0
		});

		expect(batches).toEqual([[1, 2], [3, 4], [5]]);
	});

	test("passes a generic payload filter to the scroll and the score query", async () => {
		const { dependencies, scrollCalls, denseCalls } = createWeightedFakes([1], {
			1: 0.5
		});
		const retriever = createWeightedRetriever(dependencies);
		const filters = { must: [{ key: "marque", match: { value: "Danone" } }] };

		await retriever.retrieveWeighted({
			text: "sucre",
			weights: { semantic: 1 },
			minScore: 0,
			filters
		});

		expect(scrollCalls[0]).toEqual({ filter: filters });
		expect(denseCalls[0]?.filter).toEqual(filters);
	});

	test("passes no filter when the query carries none", async () => {
		const { dependencies, scrollCalls, denseCalls } = createWeightedFakes([1], {
			1: 0.5
		});
		const retriever = createWeightedRetriever(dependencies);

		await retriever.retrieveWeighted({
			text: "sucre",
			weights: { semantic: 1 },
			minScore: 0
		});

		expect(scrollCalls[0]).toEqual({ filter: undefined });
		expect(denseCalls[0]?.filter).toBeUndefined();
	});

	test("attaches the record payload to each hit", async () => {
		const { dependencies } = createWeightedFakes([1], { 1: 0.5 });
		const retriever = createWeightedRetriever(dependencies);

		const page = await retriever.retrieveWeighted({
			text: "sucre",
			weights: { semantic: 1 },
			minScore: 0
		});

		expect(page.results[0]?.payload).toEqual({
			annee: 2005,
			marque: "Brand",
			slogan: "Texte"
		});
	});

	test("returns an empty page for a blank query without embedding", async () => {
		const { dependencies, denseQueries, scrollCalls } = createWeightedFakes([1], { 1: 1 });
		const retriever = createWeightedRetriever(dependencies);

		const page = await retriever.retrieveWeighted({
			text: "   ",
			weights: { semantic: 1 },
			minScore: 0
		});

		expect(page.results).toEqual([]);
		expect(denseQueries).toEqual([]);
		expect(scrollCalls).toEqual([]);
	});

	test("returns an empty page when the collection has no identifiers", async () => {
		const { dependencies, denseQueries } = createWeightedFakes([], {});
		const retriever = createWeightedRetriever(dependencies);

		const page = await retriever.retrieveWeighted({
			text: "sucre",
			weights: { semantic: 1 },
			minScore: 0
		});

		expect(page.results).toEqual([]);
		expect(denseQueries).toEqual([]);
	});

	test("sets an opaque nextCursor when more qualifying records remain", async () => {
		const ids = [1, 2, 3];
		const { dependencies } = createWeightedFakes(ids, {
			1: 0.9,
			2: 0.8,
			3: 0.7
		});
		const retriever = createWeightedRetriever(dependencies);

		const page = await retriever.retrieveWeighted({
			text: "sucre",
			weights: { semantic: 1 },
			minScore: 0,
			pageSize: 2
		});

		expect(page.results.map((hit) => hit.id)).toEqual([1, 2]);
		expect(typeof page.nextCursor).toBe("string");
		expect(page.nextCursor).not.toBe("2");
	});

	test("follows a cursor to the next page without rescoring", async () => {
		const ids = [1, 2, 3, 4];
		const { dependencies, denseQueries, batches } = createWeightedFakes(ids, {
			1: 0.9,
			2: 0.8,
			3: 0.7,
			4: 0.6
		});
		const retriever = createWeightedRetriever(dependencies);

		const first = await retriever.retrieveWeighted({
			text: "sucre",
			weights: { semantic: 1 },
			minScore: 0,
			pageSize: 2
		});
		const second = await retriever.retrieveWeighted({
			text: "sucre",
			weights: { semantic: 1 },
			minScore: 0,
			pageSize: 2,
			cursor: first.nextCursor ?? ""
		});

		expect(first.results.map((hit) => hit.id)).toEqual([1, 2]);
		expect(second.results.map((hit) => hit.id)).toEqual([3, 4]);
		expect(second.nextCursor).toBeUndefined();
		expect(denseQueries).toEqual(["sucre"]);
		expect(batches).toEqual([[1, 2, 3, 4]]);
	});

	test("rejects a cursor from a different query", async () => {
		const ids = [1, 2, 3];
		const { dependencies } = createWeightedFakes(ids, {
			1: 0.9,
			2: 0.8,
			3: 0.7
		});
		const retriever = createWeightedRetriever(dependencies);

		const first = await retriever.retrieveWeighted({
			text: "sucre",
			weights: { semantic: 1 },
			minScore: 0,
			pageSize: 2
		});

		await expect(
			retriever.retrieveWeighted({
				text: "autre",
				weights: { semantic: 1 },
				minScore: 0,
				pageSize: 2,
				cursor: first.nextCursor ?? ""
			})
		).rejects.toThrow(/cursor does not match/);
	});

	test("orders ties by identifier ascending", async () => {
		const { dependencies } = createWeightedFakes([3, 1, 2], {
			1: 0.5,
			2: 0.5,
			3: 0.5
		});
		const retriever = createWeightedRetriever(dependencies);

		const page = await retriever.retrieveWeighted({
			text: "sucre",
			weights: { semantic: 1 },
			minScore: 0
		});

		expect(page.results.map((hit) => hit.id)).toEqual([1, 2, 3]);
	});

	test("reports the normalization version, weights, and generation", async () => {
		const { dependencies } = createWeightedFakes([1], { 1: 0.5 });
		const retriever = createWeightedRetriever(dependencies);

		const page = await retriever.retrieveWeighted({
			text: "sucre",
			weights: { semantic: 1 },
			minScore: 0.25,
			generation: "gen-42"
		});

		expect(page.metadata).toEqual({
			weights: { syntax: 0, semantic: 1, keyword: 0 },
			minScore: 0.25,
			normalizationVersion: "1",
			generation: "gen-42"
		});
	});

	test("rejects invalid weights", async () => {
		const { dependencies } = createWeightedFakes([1], { 1: 0.5 });
		const retriever = createWeightedRetriever(dependencies);

		await expect(
			retriever.retrieveWeighted({
				text: "sucre",
				weights: { semantic: 0.5 },
				minScore: 0
			})
		).rejects.toThrow(/invalid weights/);
	});

	test("rejects an out-of-range threshold", async () => {
		const { dependencies } = createWeightedFakes([1], { 1: 0.5 });
		const retriever = createWeightedRetriever(dependencies);

		await expect(
			retriever.retrieveWeighted({
				text: "sucre",
				weights: { semantic: 1 },
				minScore: 2
			})
		).rejects.toThrow(/minScore/);
	});
});

/** Create a weighted retriever over fixed dense and sparse scores. */
const createCombinedFakes = (options: {
	ids: Array<number | string>;
	semantic?: Record<string | number, number>;
	keyword?: Record<string | number, number>;
}) => {
	const denseQueries: string[] = [];
	const sparseQueries: string[] = [];
	const dependencies = {
		embedder: {
			embedDenseQuery: async (text: string) => {
				denseQueries.push(text);

				return [0.1, 0.2];
			}
		},
		client: {
			scrollIds: async () => options.ids,
			queryDenseExact: async (query: ExactDenseQuery) => ({
				scores: query.ids
					.filter((id) => options.semantic?.[id] !== undefined)
					.map((id) => ({ id, score: options.semantic?.[id] ?? 0 })),
				missing: []
			}),
			querySparseExact: async (query: ExactSparseQuery) => {
				sparseQueries.push(query.text);

				return {
					scores: query.ids
						.filter((id) => options.keyword?.[id] !== undefined)
						.map((id) => ({
							id,
							score: options.keyword?.[id] ?? 0
						})),
					missing: query.ids.filter((id) => options.keyword?.[id] === undefined)
				};
			},
			queryAstExact: async () => ({ scores: [], missing: [] }),
			fetchPayloads: async (requested: Array<number | string>) =>
				new Map(requested.map((id) => [id, { annee: 2005 }]))
		},
		bm25: BM25
	};

	return { dependencies, denseQueries, sparseQueries };
};

describe("retrieveWeighted (keyword and combined)", () => {
	test("scores a keyword-only query and gives nonmatches zero", async () => {
		const { dependencies, denseQueries } = createCombinedFakes({
			ids: [1, 2, 3],
			keyword: { 1: 3, 2: 1 }
		});
		const retriever = createWeightedRetriever(dependencies);

		const page = await retriever.retrieveWeighted({
			text: "sucre",
			weights: { keyword: 1 },
			minScore: 0
		});

		expect(denseQueries).toEqual([]);
		expect(page.results.map((hit) => hit.id)).toEqual([1, 2, 3]);
		expect(page.results[0]?.scores.keyword).toBeCloseTo(0.5, 12);
		expect(page.results[1]?.scores.keyword).toBeCloseTo(0.25, 12);
		expect(page.results[2]?.scores.keyword).toBe(0);
	});

	test("combines semantic and keyword with explicit weights", async () => {
		const { dependencies } = createCombinedFakes({
			ids: [1, 2],
			semantic: { 1: 1, 2: 0 },
			keyword: { 1: 0, 2: 3 }
		});
		const retriever = createWeightedRetriever(dependencies);

		const page = await retriever.retrieveWeighted({
			text: "sucre",
			weights: { semantic: 0.5, keyword: 0.5 },
			minScore: 0
		});

		expect(page.results[0]).toMatchObject({ id: 1, score: 0.5 });
		expect(page.results[1]).toMatchObject({ id: 2, score: 0.25 });
	});

	test("a moderate keyword contribution qualifies a zero-semantic record", async () => {
		const { dependencies } = createCombinedFakes({
			ids: [1],
			semantic: { 1: 0 },
			keyword: { 1: 9 }
		});
		const retriever = createWeightedRetriever(dependencies);

		const page = await retriever.retrieveWeighted({
			text: "sucre",
			weights: { semantic: 0.5, keyword: 0.5 },
			minScore: 0.3
		});

		expect(page.results.map((hit) => hit.id)).toEqual([1]);
		expect(page.results[0]?.score).toBeGreaterThan(0.3);
	});

	test("a zero threshold includes keyword nonmatches", async () => {
		const { dependencies } = createCombinedFakes({
			ids: [1, 2],
			keyword: { 1: 3 }
		});
		const retriever = createWeightedRetriever(dependencies);

		const page = await retriever.retrieveWeighted({
			text: "sucre",
			weights: { keyword: 1 },
			minScore: 0
		});

		expect(page.results.map((hit) => hit.id)).toEqual([1, 2]);
		expect(page.results[1]?.score).toBe(0);
	});

	test("keeps component scores when a cursor continues a keyword page", async () => {
		const { dependencies, sparseQueries } = createCombinedFakes({
			ids: [1, 2, 3],
			keyword: { 1: 9, 2: 4, 3: 1 }
		});
		const retriever = createWeightedRetriever(dependencies);

		const first = await retriever.retrieveWeighted({
			text: "sucre",
			weights: { keyword: 1 },
			minScore: 0,
			pageSize: 2
		});
		const second = await retriever.retrieveWeighted({
			text: "sucre",
			weights: { keyword: 1 },
			minScore: 0,
			pageSize: 2,
			cursor: first.nextCursor ?? ""
		});

		expect(second.results.map((hit) => hit.id)).toEqual([3]);
		expect(second.results[0]?.scores.keyword).toBeCloseTo(normalizeBm25(1), 12);
		expect(sparseQueries).toEqual(["sucre"]);
	});
});

/** Configuration identifier used by the syntax fakes. */
const SYNTAX_CONFIG_ID = "cfg-coarse-1";

/**
 * Build a weighted retriever whose syntax, semantic, and keyword scores are injectable.
 *
 * The parser defaults to a fake that returns the fixed one-sentence tree and records each call. A
 * caller can replace it to test a missing model or a two-sentence query. The state defaults to a
 * ready assertion and records each call.
 */
const createSyntaxFakes = (options: {
	ids: Array<number | string>;
	syntax?: Record<string | number, number>;
	recordRows?: Record<string | number, number>;
	semantic?: Record<string | number, number>;
	keyword?: Record<string | number, number>;
	parsed?: ParsedText;
	parser?: Parser;
	assertSyntaxReady?: (generation: string, configId?: string) => Promise<SyntaxIndexState>;
	withSyntax?: boolean;
	withState?: boolean;
	omitAstRows?: boolean;
}) => {
	const astCalls: ExactAstQuery[] = [];
	const parseCalls: string[] = [];
	const readyCalls: Array<{ generation: string; configId?: string }> = [];
	const scrollCalls: Array<unknown> = [];
	const parser: Parser = options.parser ?? {
		parse: async (text: string) => {
			parseCalls.push(text);

			return options.parsed ?? ONE_SENTENCE;
		}
	};

	const dependencies = {
		embedder: {
			embedDenseQuery: async () => [0.1, 0.2]
		},
		client: {
			scrollIds: async (request?: unknown) => {
				scrollCalls.push(request);

				return options.ids;
			},
			queryDenseExact: async (query: ExactDenseQuery) => ({
				scores: query.ids
					.filter((id) => options.semantic?.[id] !== undefined)
					.map((id) => ({ id, score: options.semantic?.[id] ?? 0 })),
				missing: []
			}),
			querySparseExact: async (query: ExactSparseQuery) => ({
				scores: query.ids
					.filter((id) => options.keyword?.[id] !== undefined)
					.map((id) => ({ id, score: options.keyword?.[id] ?? 0 })),
				missing: []
			}),
			queryAstExact: async (query: ExactAstQuery) => {
				astCalls.push(query);

				return {
					scores: query.ids
						.filter((id) => options.syntax?.[id] !== undefined)
						.map((id) => ({
							id,
							score: options.syntax?.[id] ?? 0,
							...(options.omitAstRows === true
								? {}
								: { rows: options.recordRows?.[id] ?? 1 })
						})),
					missing: []
				};
			},
			fetchPayloads: async (requested: Array<number | string>) =>
				new Map(requested.map((id) => [id, { annee: 2005 }]))
		},
		bm25: BM25,
		generation: "gen-1",
		syntax:
			options.withSyntax === false
				? undefined
				: {
						parser,
						encode: encodeTree,
						mode: "coarse" as SyntaxMode,
						configId: SYNTAX_CONFIG_ID
					},
		state:
			options.withState === false
				? undefined
				: {
						assertSyntaxReady: async (generation: string, configId?: string) => {
							readyCalls.push({ generation, configId });

							if (options.assertSyntaxReady !== undefined) {
								return options.assertSyntaxReady(generation, configId);
							}

							return {} as SyntaxIndexState;
						}
					}
	};

	return { dependencies, astCalls, parseCalls, readyCalls, scrollCalls };
};

describe("retrieveWeighted (syntax)", () => {
	test("selects the syntax index alone and normalizes by the larger row count", async () => {
		const { dependencies, astCalls, parseCalls, readyCalls } = createSyntaxFakes({
			ids: [1, 2],
			syntax: { 1: 2.0, 2: 0.5 },
			recordRows: { 1: 2, 2: 1 }
		});
		const retriever = createWeightedRetriever(dependencies);

		const page = await retriever.retrieveWeighted({
			text: "Le garçon regarde le soleil",
			weights: { syntax: 1 },
			minScore: 0
		});

		expect(readyCalls).toEqual([{ generation: "gen-1", configId: SYNTAX_CONFIG_ID }]);
		expect(parseCalls).toEqual(["Le garçon regarde le soleil"]);
		expect(astCalls).toHaveLength(1);
		expect(astCalls[0]?.rows).toHaveLength(1);
		expect(astCalls[0]).toMatchObject({
			ids: [1, 2],
			withRows: true,
			onMissing: "skip"
		});
		expect(page.results).toEqual([
			{
				id: 1,
				score: 1.0,
				scores: { syntax: 1.0, semantic: 0, keyword: 0 },
				payload: { annee: 2005 }
			},
			{
				id: 2,
				score: 0.5,
				scores: { syntax: 0.5, semantic: 0, keyword: 0 },
				payload: { annee: 2005 }
			}
		]);
		expect(page.metadata.syntaxConfigId).toBe(SYNTAX_CONFIG_ID);
	});

	test("normalizes a two-sentence query by the larger row count", async () => {
		const { dependencies, astCalls } = createSyntaxFakes({
			ids: [1],
			syntax: { 1: 1.5 },
			recordRows: { 1: 1 },
			parsed: TWO_SENTENCES
		});
		const retriever = createWeightedRetriever(dependencies);

		const page = await retriever.retrieveWeighted({
			text: "Deux phrases. Et une autre.",
			weights: { syntax: 1 },
			minScore: 0
		});

		expect(astCalls[0]?.rows).toHaveLength(2);
		expect(page.results[0]?.scores.syntax).toBeCloseTo(
			normalizeMultivectorMaxSim(1.5, 2, 1),
			12
		);
		expect(page.results[0]?.scores.syntax).toBeCloseTo(0.75, 12);
	});

	test("combines syntax, semantic, and keyword with explicit weights", async () => {
		const { dependencies } = createSyntaxFakes({
			ids: [1],
			syntax: { 1: 2.0 },
			recordRows: { 1: 2 },
			semantic: { 1: 1 },
			keyword: { 1: 3 }
		});
		const retriever = createWeightedRetriever(dependencies);

		const page = await retriever.retrieveWeighted({
			text: "Le garçon regarde le soleil",
			weights: { syntax: 0.5, semantic: 0.3, keyword: 0.2 },
			minScore: 0
		});

		expect(page.results[0]?.scores).toEqual({
			syntax: 1.0,
			semantic: 1.0,
			keyword: normalizeBm25(3)
		});
		expect(page.results[0]?.score).toBeCloseTo(0.5 + 0.3 + 0.2 * normalizeBm25(3), 12);
	});

	test("a record without an ast vector is outside the syntax scope", async () => {
		const { dependencies } = createSyntaxFakes({
			ids: [1, 2],
			syntax: { 1: 2.0 },
			recordRows: { 1: 2 }
		});
		const retriever = createWeightedRetriever(dependencies);

		const page = await retriever.retrieveWeighted({
			text: "Le garçon regarde le soleil",
			weights: { syntax: 1 },
			minScore: 0.5
		});

		expect(page.results.map((hit) => hit.id)).toEqual([1]);
	});

	test("fails loudly when the ast transport omits the row count", async () => {
		const { dependencies } = createSyntaxFakes({
			ids: [1],
			syntax: { 1: 2.0 },
			omitAstRows: true
		});
		const retriever = createWeightedRetriever(dependencies);

		await expect(
			retriever.retrieveWeighted({
				text: "Le garçon regarde le soleil",
				weights: { syntax: 1 },
				minScore: 0
			})
		).rejects.toThrow(/row count/);
	});

	test("a blank query returns an empty page without a parser call", async () => {
		const { dependencies, astCalls, parseCalls, readyCalls, scrollCalls } = createSyntaxFakes({
			ids: [1],
			syntax: { 1: 1 }
		});
		const retriever = createWeightedRetriever(dependencies);

		const page = await retriever.retrieveWeighted({
			text: "   ",
			weights: { syntax: 1 },
			minScore: 0
		});

		expect(page.results).toEqual([]);
		expect(parseCalls).toEqual([]);
		expect(astCalls).toEqual([]);
		expect(readyCalls).toEqual([]);
		expect(scrollCalls).toEqual([]);
	});

	test("passes the generic filter to the ast query", async () => {
		const { dependencies, astCalls } = createSyntaxFakes({
			ids: [1],
			syntax: { 1: 1 }
		});
		const retriever = createWeightedRetriever(dependencies);
		const filters = { must: [{ key: "marque", match: { value: "Danone" } }] };

		await retriever.retrieveWeighted({
			text: "Le garçon regarde le soleil",
			weights: { syntax: 1 },
			minScore: 0,
			filters
		});

		expect(astCalls[0]?.filter).toEqual(filters);
	});
});

describe("retrieveWeighted (syntax readiness)", () => {
	test("a missing syntax state throws SyntaxNotReadyError before any query", async () => {
		const { dependencies, scrollCalls } = createSyntaxFakes({
			ids: [1],
			syntax: { 1: 1 },
			assertSyntaxReady: async () => {
				throw new SyntaxNotReadyError("gen-1", "missing");
			}
		});
		const retriever = createWeightedRetriever(dependencies);

		await expect(
			retriever.retrieveWeighted({
				text: "Le garçon regarde le soleil",
				weights: { syntax: 1 },
				minScore: 0
			})
		).rejects.toBeInstanceOf(SyntaxNotReadyError);
		expect(scrollCalls).toEqual([]);
	});

	test("a pending syntax state throws SyntaxNotReadyError", async () => {
		const { dependencies } = createSyntaxFakes({
			ids: [1],
			syntax: { 1: 1 },
			assertSyntaxReady: async () => {
				throw new SyntaxNotReadyError("gen-1", "pending", "generation status rebuilding");
			}
		});
		const retriever = createWeightedRetriever(dependencies);

		await expect(
			retriever.retrieveWeighted({
				text: "Le garçon regarde le soleil",
				weights: { syntax: 1 },
				minScore: 0
			})
		).rejects.toMatchObject({ name: "SyntaxNotReadyError", reason: "pending" });
	});

	test("a config-mismatched syntax state throws SyntaxNotReadyError", async () => {
		const { dependencies } = createSyntaxFakes({
			ids: [1],
			syntax: { 1: 1 },
			assertSyntaxReady: async () => {
				throw new SyntaxNotReadyError("gen-1", "config-mismatch", "expected other");
			}
		});
		const retriever = createWeightedRetriever(dependencies);

		await expect(
			retriever.retrieveWeighted({
				text: "Le garçon regarde le soleil",
				weights: { syntax: 1 },
				minScore: 0
			})
		).rejects.toMatchObject({ name: "SyntaxNotReadyError", reason: "config-mismatch" });
	});

	test("a changed generation throws StaleGenerationError", async () => {
		const { dependencies } = createSyntaxFakes({
			ids: [1],
			syntax: { 1: 1 },
			assertSyntaxReady: async () => {
				throw new StaleGenerationError("gen-1", "gen-2");
			}
		});
		const retriever = createWeightedRetriever(dependencies);

		await expect(
			retriever.retrieveWeighted({
				text: "Le garçon regarde le soleil",
				weights: { syntax: 1 },
				minScore: 0
			})
		).rejects.toBeInstanceOf(StaleGenerationError);
	});

	test("a missing parser model throws ParserUnavailableError", async () => {
		const { dependencies } = createSyntaxFakes({
			ids: [1],
			syntax: { 1: 1 },
			parser: {
				parse: async () => {
					throw new ParserUnavailableError("model not found");
				}
			}
		});
		const retriever = createWeightedRetriever(dependencies);

		await expect(
			retriever.retrieveWeighted({
				text: "Le garçon regarde le soleil",
				weights: { syntax: 1 },
				minScore: 0
			})
		).rejects.toBeInstanceOf(ParserUnavailableError);
	});

	test("a query without a positive syntax weight never reads the syntax dependency", async () => {
		const { dependencies, parseCalls, readyCalls } = createSyntaxFakes({
			ids: [1],
			semantic: { 1: 1 },
			parser: {
				parse: async () => {
					throw new Error("parser must not be called");
				}
			},
			assertSyntaxReady: async () => {
				throw new Error("state must not be read");
			}
		});
		const retriever = createWeightedRetriever(dependencies);

		const page = await retriever.retrieveWeighted({
			text: "sucre",
			weights: { semantic: 1 },
			minScore: 0
		});

		expect(page.results.map((hit) => hit.id)).toEqual([1]);
		expect(parseCalls).toEqual([]);
		expect(readyCalls).toEqual([]);
		expect(page.metadata.syntaxConfigId).toBeUndefined();
	});

	test("rejects a positive syntax weight when the syntax dependencies are absent", async () => {
		const { dependencies } = createSyntaxFakes({
			ids: [1],
			withSyntax: false,
			withState: false
		});
		const retriever = createWeightedRetriever(dependencies);

		await expect(
			retriever.retrieveWeighted({
				text: "Le garçon regarde le soleil",
				weights: { syntax: 1 },
				minScore: 0
			})
		).rejects.toThrow(/syntax dependencies are missing/);
	});
});
