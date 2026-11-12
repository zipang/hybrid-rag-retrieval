import { describe, expect, test } from "bun:test";
import type { SyntaxIndexState } from "./index-state";
import { StaleGenerationError, SyntaxNotReadyError } from "./index-state";
import type { CollectionSchema } from "./qdrant-schema";
import type { VectorQuery } from "./qdrant";
import { createWeightedRetriever } from "./retrieval";
import { normalizeBm25, normalizeMultivectorMaxSim } from "./scoring";
import type { SyntaxMode } from "./syntax/abstraction";
import { encodeTree } from "./syntax/encoder";
import { type ParsedText, type Parser, ParserUnavailableError } from "./syntax/parser";

/** BM25 options shared by the weighted fakes. */
const BM25 = { language: "french", ascii_folding: true, avg_len: 7 };

/** Schema whose vector names match the slogan dataset. */
const SCHEMA: CollectionSchema = {
	collection: "slogans",
	dense: { name: "dense", size: 2, distance: "Cosine" },
	sparse: { name: "bm25", modifier: "idf" },
	ast: { name: "ast", size: 2, distance: "Cosine", comparator: "max_sim" },
	payloadIndexes: []
};

/** One scored hit returned by a fake bounded query. */
type Hit = { id: number | string; score: number };

/**
 * Create a weighted retriever over fake bounded hits.
 *
 * The fake client exposes `queryVector` and `fetchPayloads`, and a `scrollIds` spy that throws. A
 * test asserts that the bounded path never calls `scrollIds`.
 */
const createFakes = (
	options: {
		dense?: Hit[];
		bm25?: Hit[];
		ast?: Hit[];
		schema?: CollectionSchema;
		payload?: Record<string | number, Record<string, unknown>>;
	} = {}
) => {
	const vectorCalls: VectorQuery[] = [];
	const scrollCalls: Array<unknown> = [];
	const schema = options.schema ?? SCHEMA;
	const client = {
		schema,
		queryVector: async (query: VectorQuery) => {
			vectorCalls.push(query);

			if (query.using === schema.dense.name) {
				return options.dense ?? [];
			}

			if (query.using === schema.sparse.name) {
				return options.bm25 ?? [];
			}

			if (schema.ast !== undefined && query.using === schema.ast.name) {
				return options.ast ?? [];
			}

			return [];
		},
		scrollIds: async (request?: unknown) => {
			scrollCalls.push(request);

			throw new Error("scrollIds must not be called on the bounded path");
		},
		fetchPayloads: async (ids: Array<number | string>) =>
			new Map(
				ids.map((id) => [
					id,
					options.payload?.[id] ?? { annee: 2005, marque: "Brand", slogan: "Texte" }
				])
			)
	};
	const dependencies = {
		embedder: { embedDenseQuery: async () => [0.1, 0.2] },
		client,
		bm25: BM25
	};

	return { dependencies, vectorCalls, scrollCalls };
};

describe("retrieveWeighted (bounded)", () => {
	test("runs one bounded query per selected index with the same limit and never scrolls", async () => {
		const { dependencies, vectorCalls, scrollCalls } = createFakes({
			dense: [{ id: 1, score: 0.8 }],
			bm25: [{ id: 2, score: 3 }]
		});
		const retriever = createWeightedRetriever(dependencies);

		const page = await retriever.retrieveWeighted({
			text: "sucre",
			weights: { semantic: 0.5, keyword: 0.5 },
			minScore: 0,
			limit: 25
		});

		expect(vectorCalls.map((call) => call.using)).toEqual(["dense", "bm25"]);
		expect(vectorCalls.every((call) => call.limit === 25)).toBe(true);
		expect(scrollCalls).toEqual([]);
		expect(page.results.map((hit) => hit.id).sort()).toEqual([1, 2]);
	});

	test("defaults the candidate limit to 50", async () => {
		const { dependencies, vectorCalls } = createFakes({ dense: [{ id: 1, score: 0.5 }] });
		const retriever = createWeightedRetriever(dependencies);

		await retriever.retrieveWeighted({ text: "sucre", weights: { semantic: 1 }, minScore: 0 });

		expect(vectorCalls[0]?.limit).toBe(50);
	});

	test("clamps a limit below the minimum to 1", async () => {
		const { dependencies, vectorCalls } = createFakes({ dense: [{ id: 1, score: 0.5 }] });
		const retriever = createWeightedRetriever(dependencies);

		await retriever.retrieveWeighted({
			text: "sucre",
			weights: { semantic: 1 },
			minScore: 0,
			limit: 0
		});

		expect(vectorCalls[0]?.limit).toBe(1);
	});

	test("clamps a limit above the maximum to 1000", async () => {
		const { dependencies, vectorCalls } = createFakes({ dense: [{ id: 1, score: 0.5 }] });
		const retriever = createWeightedRetriever(dependencies);

		await retriever.retrieveWeighted({
			text: "sucre",
			weights: { semantic: 1 },
			minScore: 0,
			limit: 5000
		});

		expect(vectorCalls[0]?.limit).toBe(1000);
	});

	test("unions the per-index hits and scores an absent index zero", async () => {
		const { dependencies } = createFakes({
			dense: [
				{ id: 1, score: 1 },
				{ id: 2, score: 0.5 }
			],
			bm25: [
				{ id: 2, score: 3 },
				{ id: 3, score: 9 }
			]
		});
		const retriever = createWeightedRetriever(dependencies);

		const page = await retriever.retrieveWeighted({
			text: "sucre",
			weights: { semantic: 0.5, keyword: 0.5 },
			minScore: 0
		});
		const byId = new Map(page.results.map((hit) => [hit.id, hit]));

		expect([...byId.keys()].sort()).toEqual([1, 2, 3]);
		expect(byId.get(1)?.scores).toEqual({ syntax: 0, semantic: 1, keyword: 0 });
		expect(byId.get(3)?.scores).toEqual({ syntax: 0, semantic: 0, keyword: normalizeBm25(9) });
	});

	test("normalizes cosine and clips negative values to zero", async () => {
		const { dependencies } = createFakes({
			dense: [
				{ id: 1, score: 0.8 },
				{ id: 2, score: -0.5 }
			]
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
		const { dependencies } = createFakes({
			dense: [
				{ id: 1, score: 0.8 },
				{ id: 2, score: 0.5 },
				{ id: 3, score: 0.4999999 }
			]
		});
		const retriever = createWeightedRetriever(dependencies);

		const page = await retriever.retrieveWeighted({
			text: "sucre",
			weights: { semantic: 1 },
			minScore: 0.5
		});

		expect(page.results.map((hit) => hit.id)).toEqual([1, 2]);
	});

	test("returns an empty page when no candidate qualifies", async () => {
		const { dependencies } = createFakes({
			dense: [
				{ id: 1, score: 0.2 },
				{ id: 2, score: 0.3 }
			]
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

	test("a zero threshold includes a zero-score candidate", async () => {
		const { dependencies } = createFakes({
			dense: [
				{ id: 1, score: 0.9 },
				{ id: 2, score: -1 }
			]
		});
		const retriever = createWeightedRetriever(dependencies);

		const page = await retriever.retrieveWeighted({
			text: "sucre",
			weights: { semantic: 1 },
			minScore: 0
		});

		expect(page.results.map((hit) => hit.id)).toEqual([1, 2]);
	});

	test("orders ties by identifier ascending", async () => {
		const { dependencies } = createFakes({
			dense: [
				{ id: 3, score: 0.5 },
				{ id: 1, score: 0.5 },
				{ id: 2, score: 0.5 }
			]
		});
		const retriever = createWeightedRetriever(dependencies);

		const page = await retriever.retrieveWeighted({
			text: "sucre",
			weights: { semantic: 1 },
			minScore: 0
		});

		expect(page.results.map((hit) => hit.id)).toEqual([1, 2, 3]);
	});

	test("paginates the ranked candidates and follows a cursor without requerying", async () => {
		const { dependencies, vectorCalls } = createFakes({
			dense: [
				{ id: 1, score: 0.9 },
				{ id: 2, score: 0.8 },
				{ id: 3, score: 0.7 }
			]
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
		expect(typeof first.nextCursor).toBe("string");
		expect(second.results.map((hit) => hit.id)).toEqual([3]);
		expect(second.nextCursor).toBeUndefined();
		expect(vectorCalls).toHaveLength(1);
	});

	test("returns an empty page for a blank query without reading an index", async () => {
		const { dependencies, vectorCalls, scrollCalls } = createFakes({
			dense: [{ id: 1, score: 1 }]
		});
		const retriever = createWeightedRetriever(dependencies);

		const page = await retriever.retrieveWeighted({
			text: "   ",
			weights: { semantic: 1 },
			minScore: 0
		});

		expect(page.results).toEqual([]);
		expect(vectorCalls).toEqual([]);
		expect(scrollCalls).toEqual([]);
	});

	test("passes the generic payload filter to every bounded query", async () => {
		const { dependencies, vectorCalls } = createFakes({
			dense: [{ id: 1, score: 0.5 }],
			bm25: [{ id: 2, score: 3 }]
		});
		const retriever = createWeightedRetriever(dependencies);
		const filters = { must: [{ key: "marque", match: { value: "Danone" } }] };

		await retriever.retrieveWeighted({
			text: "sucre",
			weights: { semantic: 0.5, keyword: 0.5 },
			minScore: 0,
			filters
		});

		expect(vectorCalls).toHaveLength(2);
		expect(vectorCalls.every((call) => call.filter === filters)).toBe(true);
	});

	test("passes no filter when the query carries none", async () => {
		const { dependencies, vectorCalls } = createFakes({ dense: [{ id: 1, score: 0.5 }] });
		const retriever = createWeightedRetriever(dependencies);

		await retriever.retrieveWeighted({ text: "sucre", weights: { semantic: 1 }, minScore: 0 });

		expect(vectorCalls[0]?.filter).toBeUndefined();
	});

	test("passes the BM25 options in the keyword query", async () => {
		const { dependencies, vectorCalls } = createFakes({ bm25: [{ id: 1, score: 3 }] });
		const retriever = createWeightedRetriever(dependencies);

		await retriever.retrieveWeighted({ text: "sucre", weights: { keyword: 1 }, minScore: 0 });

		expect(vectorCalls[0]?.query).toEqual({
			text: "sucre",
			model: "qdrant/bm25",
			options: BM25
		});
	});

	test("resolves the vector names from the collection schema", async () => {
		const custom: CollectionSchema = {
			collection: "poems",
			dense: { name: "embedding", size: 2, distance: "Dot" },
			sparse: { name: "terms", modifier: "idf" }
		};
		const { dependencies, vectorCalls } = createFakes({
			schema: custom,
			dense: [{ id: 1, score: 0.5 }],
			bm25: [{ id: 2, score: 3 }]
		});
		const retriever = createWeightedRetriever(dependencies);

		await retriever.retrieveWeighted({
			text: "sucre",
			weights: { semantic: 0.5, keyword: 0.5 },
			minScore: 0
		});

		expect(vectorCalls.map((call) => call.using)).toEqual(["embedding", "terms"]);
	});

	test("attaches the record payload to each hit", async () => {
		const { dependencies } = createFakes({ dense: [{ id: 1, score: 0.5 }] });
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

	test("reports the normalization version, weights, and generation", async () => {
		const { dependencies } = createFakes({ dense: [{ id: 1, score: 0.5 }] });
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
		const { dependencies } = createFakes({ dense: [{ id: 1, score: 0.5 }] });
		const retriever = createWeightedRetriever(dependencies);

		await expect(
			retriever.retrieveWeighted({ text: "sucre", weights: { semantic: 0.5 }, minScore: 0 })
		).rejects.toThrow(/invalid weights/);
	});

	test("rejects an out-of-range threshold", async () => {
		const { dependencies } = createFakes({ dense: [{ id: 1, score: 0.5 }] });
		const retriever = createWeightedRetriever(dependencies);

		await expect(
			retriever.retrieveWeighted({ text: "sucre", weights: { semantic: 1 }, minScore: 2 })
		).rejects.toThrow(/minScore/);
	});
});

/** Configuration identifier used by the syntax fakes. */
const SYNTAX_CONFIG_ID = "cfg-coarse-1";

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

/**
 * Build a weighted retriever whose syntax, semantic, and keyword hits are injectable.
 *
 * The parser defaults to a fake that returns the fixed one-sentence tree and records each call. The
 * state defaults to a ready assertion and records each call.
 */
const createSyntaxFakes = (options: {
	ast?: Hit[];
	semantic?: Hit[];
	keyword?: Hit[];
	parsed?: ParsedText;
	parser?: Parser;
	assertSyntaxReady?: (generation: string, configId?: string) => Promise<SyntaxIndexState>;
	withSyntax?: boolean;
	withState?: boolean;
}) => {
	const vectorCalls: VectorQuery[] = [];
	const parseCalls: string[] = [];
	const readyCalls: Array<{ generation: string; configId?: string }> = [];
	const parser: Parser = options.parser ?? {
		parse: async (text: string) => {
			parseCalls.push(text);

			return options.parsed ?? ONE_SENTENCE;
		}
	};
	const client = {
		schema: SCHEMA,
		queryVector: async (query: VectorQuery) => {
			vectorCalls.push(query);

			if (query.using === SCHEMA.dense.name) {
				return options.semantic ?? [];
			}

			if (query.using === SCHEMA.sparse.name) {
				return options.keyword ?? [];
			}

			if (query.using === "ast") {
				return options.ast ?? [];
			}

			return [];
		},
		scrollIds: async () => {
			throw new Error("scrollIds must not be called on the bounded path");
		},
		fetchPayloads: async (ids: Array<number | string>) =>
			new Map(ids.map((id) => [id, { annee: 2005 }]))
	};
	const dependencies = {
		embedder: { embedDenseQuery: async () => [0.1, 0.2] },
		client,
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

	return { dependencies, vectorCalls, parseCalls, readyCalls };
};

describe("retrieveWeighted (syntax)", () => {
	test("selects the syntax index alone and normalizes by the query row count", async () => {
		const { dependencies, vectorCalls, parseCalls, readyCalls } = createSyntaxFakes({
			ast: [
				{ id: 1, score: 2.0 },
				{ id: 2, score: 0.5 }
			]
		});
		const retriever = createWeightedRetriever(dependencies);

		const page = await retriever.retrieveWeighted({
			text: "Le garçon regarde le soleil",
			weights: { syntax: 1 },
			minScore: 0,
			limit: 25
		});

		expect(readyCalls).toEqual([{ generation: "gen-1", configId: SYNTAX_CONFIG_ID }]);
		expect(parseCalls).toEqual(["Le garçon regarde le soleil"]);
		expect(vectorCalls).toHaveLength(1);
		expect(vectorCalls[0]).toMatchObject({ using: "ast", limit: 25 });
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

	test("normalizes a two-sentence query by the query row count", async () => {
		const { dependencies, vectorCalls } = createSyntaxFakes({
			ast: [{ id: 1, score: 1.5 }],
			parsed: TWO_SENTENCES
		});
		const retriever = createWeightedRetriever(dependencies);

		const page = await retriever.retrieveWeighted({
			text: "Deux phrases. Et une autre.",
			weights: { syntax: 1 },
			minScore: 0
		});

		expect(vectorCalls[0]?.query).toHaveLength(2);
		expect(page.results[0]?.scores.syntax).toBeCloseTo(
			normalizeMultivectorMaxSim(1.5, 2, 2),
			12
		);
		expect(page.results[0]?.scores.syntax).toBeCloseTo(0.75, 12);
	});

	test("combines syntax, semantic, and keyword with explicit weights", async () => {
		const { dependencies } = createSyntaxFakes({
			ast: [{ id: 1, score: 2.0 }],
			semantic: [{ id: 1, score: 1 }],
			keyword: [{ id: 1, score: 3 }]
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

	test("a record absent from the ast hits scores zero syntax", async () => {
		const { dependencies } = createSyntaxFakes({
			ast: [{ id: 1, score: 2.0 }],
			semantic: [
				{ id: 1, score: 1 },
				{ id: 2, score: 0.2 }
			]
		});
		const retriever = createWeightedRetriever(dependencies);

		const page = await retriever.retrieveWeighted({
			text: "Le garçon regarde le soleil",
			weights: { syntax: 0.5, semantic: 0.5 },
			minScore: 0
		});
		const byId = new Map(page.results.map((hit) => [hit.id, hit]));

		expect(byId.get(2)?.scores).toEqual({ syntax: 0, semantic: 0.2, keyword: 0 });
	});

	test("a syntax-only query never lists a record without an ast vector", async () => {
		const { dependencies, vectorCalls } = createSyntaxFakes({
			ast: [{ id: 1, score: 2.0 }],
			semantic: [{ id: 2, score: 1 }]
		});
		const retriever = createWeightedRetriever(dependencies);

		const page = await retriever.retrieveWeighted({
			text: "Le garçon regarde le soleil",
			weights: { syntax: 1 },
			minScore: 0
		});

		// The candidate set is the ast hits only, so the semantic-only record is never read and
		// never listed, even at a zero threshold. The exhaustive path listed it with a zero syntax
		// component.
		expect(vectorCalls.map((call) => call.using)).toEqual(["ast"]);
		expect(page.results.map((hit) => hit.id)).toEqual([1]);
	});

	test("a blank query returns an empty page without a parser call", async () => {
		const { dependencies, vectorCalls, parseCalls, readyCalls } = createSyntaxFakes({
			ast: [{ id: 1, score: 1 }]
		});
		const retriever = createWeightedRetriever(dependencies);

		const page = await retriever.retrieveWeighted({
			text: "   ",
			weights: { syntax: 1 },
			minScore: 0
		});

		expect(page.results).toEqual([]);
		expect(parseCalls).toEqual([]);
		expect(vectorCalls).toEqual([]);
		expect(readyCalls).toEqual([]);
	});

	test("passes the generic filter to the ast query", async () => {
		const { dependencies, vectorCalls } = createSyntaxFakes({ ast: [{ id: 1, score: 1 }] });
		const retriever = createWeightedRetriever(dependencies);
		const filters = { must: [{ key: "marque", match: { value: "Danone" } }] };

		await retriever.retrieveWeighted({
			text: "Le garçon regarde le soleil",
			weights: { syntax: 1 },
			minScore: 0,
			filters
		});

		expect(vectorCalls[0]?.filter).toEqual(filters);
	});

	test("rejects a positive syntax weight when the collection schema has no ast vector", async () => {
		const schema: CollectionSchema = {
			collection: "poems",
			dense: { name: "dense", size: 2, distance: "Cosine" },
			sparse: { name: "bm25", modifier: "idf" }
		};
		const { dependencies } = createSyntaxFakes({});
		const client = { ...dependencies.client, schema };
		const retriever = createWeightedRetriever({ ...dependencies, client });

		await expect(
			retriever.retrieveWeighted({
				text: "Le garçon regarde le soleil",
				weights: { syntax: 1 },
				minScore: 0
			})
		).rejects.toThrow(/no ast vector/);
	});
});

describe("retrieveWeighted (syntax readiness)", () => {
	test("a missing syntax state throws SyntaxNotReadyError before any query", async () => {
		const { dependencies, vectorCalls } = createSyntaxFakes({
			ast: [{ id: 1, score: 1 }],
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
		expect(vectorCalls).toEqual([]);
	});

	test("a pending syntax state throws SyntaxNotReadyError", async () => {
		const { dependencies } = createSyntaxFakes({
			ast: [{ id: 1, score: 1 }],
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

	test("a changed generation throws StaleGenerationError", async () => {
		const { dependencies } = createSyntaxFakes({
			ast: [{ id: 1, score: 1 }],
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
			ast: [{ id: 1, score: 1 }],
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
			semantic: [{ id: 1, score: 1 }],
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
