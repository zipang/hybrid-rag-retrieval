import { describe, expect, test } from "bun:test";
import {
	createQdrantClient,
	IncompatibleAstVectorError,
	maxMultiVectorRows,
	MULTIVECTOR_SUBVECTOR_LIMIT,
	MultiVectorLimitError,
	MultiVectorValueError,
	type Point
} from "./qdrant";
import type { CollectionSchema } from "./qdrant-schema";

/** Test collection schema with no dataset-specific constant. */
const SCHEMA: CollectionSchema = {
	collection: "slogans",
	dense: { name: "dense", size: 1024, distance: "Cosine" },
	sparse: { name: "bm25", modifier: "idf" },
	payloadIndexes: [
		{ name: "annee", schema: "integer" },
		{ name: "marque", schema: "keyword" }
	]
};

type StubCall = {
	method: string;
	url: string;
	body: unknown;
};

type StubResponse = {
	status?: number;
	result?: unknown;
	error?: string;
};

const BASE = "http://qdrant.test:6333/collections/slogans";

/** Build a JSON response that mimics the Qdrant envelope. */
const jsonResponse = (response: StubResponse = {}): Response => {
	const payload =
		response.error !== undefined
			? { status: { error: response.error }, time: 0 }
			: { result: response.result, status: "ok", time: 0 };

	return new Response(JSON.stringify(payload), {
		status: response.status ?? 200,
		headers: { "content-type": "application/json" }
	});
};

/** Create a client whose fetch records calls and defers replies to a handler. */
const createTestClient = (handler: (call: StubCall) => Response) => {
	const calls: StubCall[] = [];
	const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
		const url =
			typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
		const method = init?.method ?? "GET";
		const body = init?.body === undefined ? undefined : JSON.parse(String(init.body));
		const call: StubCall = { method, url, body };
		calls.push(call);

		return handler(call);
	}) as unknown as typeof fetch;

	const client = createQdrantClient(SCHEMA, { QDRANT_URL: "http://qdrant.test:6333" }, fetchImpl);

	return { client, calls };
};

describe("ensureCollection", () => {
	test("creates the collection and payload indexes when absent", async () => {
		const { client, calls } = createTestClient((call) =>
			call.url.endsWith("/exists")
				? jsonResponse({ result: { exists: false } })
				: jsonResponse()
		);

		expect(await client.ensureCollection()).toBe(true);
		expect(calls).toHaveLength(4);
		expect(calls[0]).toEqual({
			method: "GET",
			url: `${BASE}/exists`,
			body: undefined
		});
		expect(calls[1]?.method).toBe("PUT");
		expect(calls[1]?.url).toBe(BASE);
		expect(calls[1]?.body).toEqual({
			vectors: { dense: { size: 1024, distance: "Cosine" } },
			sparse_vectors: { bm25: { modifier: "idf" } }
		});
		expect(calls[2]?.body).toEqual({
			field_name: "annee",
			field_schema: "integer"
		});
		expect(calls[3]?.body).toEqual({
			field_name: "marque",
			field_schema: "keyword"
		});
	});

	test("leaves an existing collection untouched", async () => {
		const { client, calls } = createTestClient(() =>
			jsonResponse({ result: { exists: true } })
		);

		expect(await client.ensureCollection()).toBe(false);
		expect(calls).toHaveLength(1);
	});

	test("creates the collection from a custom schema with no slogan field names", async () => {
		const custom: CollectionSchema = {
			collection: "poems",
			dense: { name: "embedding", size: 768, distance: "Dot" },
			sparse: { name: "terms" },
			payloadIndexes: [
				{ name: "poet", schema: "keyword" },
				{ name: "published", schema: "datetime" }
			]
		};
		const calls: StubCall[] = [];
		const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
			const url =
				typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
			calls.push({
				method: init?.method ?? "GET",
				url,
				body: init?.body === undefined ? undefined : JSON.parse(String(init.body))
			});

			return url.endsWith("/exists")
				? jsonResponse({ result: { exists: false } })
				: jsonResponse();
		}) as unknown as typeof fetch;
		const client = createQdrantClient(
			custom,
			{ QDRANT_URL: "http://qdrant.test:6333" },
			fetchImpl
		);

		await client.ensureCollection();

		expect(calls[1]?.url).toBe("http://qdrant.test:6333/collections/poems");
		expect(calls[1]?.body).toEqual({
			vectors: { embedding: { size: 768, distance: "Dot" } },
			sparse_vectors: { terms: {} }
		});
		expect(calls[2]?.body).toEqual({
			field_name: "poet",
			field_schema: "keyword"
		});
		expect(calls[3]?.body).toEqual({
			field_name: "published",
			field_schema: "datetime"
		});
	});
});

describe("deleteCollection", () => {
	test("deletes the collection when it exists", async () => {
		const { client, calls } = createTestClient((call) =>
			call.method === "GET" ? jsonResponse({ result: { exists: true } }) : jsonResponse()
		);

		await client.deleteCollection();

		expect(calls.map((call) => call.method)).toEqual(["GET", "DELETE"]);
		expect(calls[1]?.url).toBe(BASE);
	});

	test("does nothing when the collection is absent", async () => {
		const { client, calls } = createTestClient(() =>
			jsonResponse({ result: { exists: false } })
		);

		await client.deleteCollection();

		expect(calls).toHaveLength(1);
	});
});

describe("upsert", () => {
	const point: Point = {
		id: 1,
		vector: {
			dense: [0.1, 0.2],
			bm25: { text: "Un peu de sucre", model: "qdrant/bm25" }
		},
		payload: {
			id: "1",
			annee: 2005,
			marque: "Danone",
			slogan: "Un peu de sucre"
		}
	};

	test("sends points with the schema vector names and waits by default", async () => {
		const { client, calls } = createTestClient(() => jsonResponse());

		await client.upsert([point]);

		expect(calls[0]?.method).toBe("PUT");
		expect(calls[0]?.url).toBe(`${BASE}/points?wait=true`);
		expect(calls[0]?.body).toEqual({
			points: [
				{
					id: point.id,
					vector: {
						dense: point.vector.dense,
						bm25: point.vector.bm25
					},
					payload: point.payload
				}
			]
		});
	});

	test("maps the vector kinds to custom schema vector names", async () => {
		const custom: CollectionSchema = {
			collection: "poems",
			dense: { name: "embedding", size: 4, distance: "Dot" },
			sparse: { name: "terms" }
		};
		const calls: StubCall[] = [];
		const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
			const url =
				typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
			calls.push({
				method: init?.method ?? "GET",
				url,
				body: init?.body === undefined ? undefined : JSON.parse(String(init.body))
			});

			return jsonResponse();
		}) as unknown as typeof fetch;
		const client = createQdrantClient(
			custom,
			{ QDRANT_URL: "http://qdrant.test:6333" },
			fetchImpl
		);

		await client.upsert([point]);

		expect(calls[0]?.body).toEqual({
			points: [
				{
					id: point.id,
					vector: {
						embedding: point.vector.dense,
						terms: point.vector.bm25
					},
					payload: point.payload
				}
			]
		});
	});

	test("honors wait:false", async () => {
		const { client, calls } = createTestClient(() => jsonResponse());

		await client.upsert([point], { wait: false });

		expect(calls[0]?.url).toBe(`${BASE}/points?wait=false`);
	});
});

describe("queryHybrid", () => {
	test("builds prefetches, applies the filter, and returns hits", async () => {
		const hits = [{ id: 1, score: 0.5, payload: { slogan: "Un peu de sucre" } }];
		const { client, calls } = createTestClient(() =>
			jsonResponse({ result: { points: hits } })
		);
		const filter = {
			must: [{ key: "annee", range: { gte: 2004, lte: 2005 } }]
		};

		const result = await client.queryHybrid({
			dense: [0.1, 0.2],
			text: "sucre",
			bm25Options: { language: "french", ascii_folding: true },
			limit: 3,
			filter
		});

		expect(result).toEqual(hits);
		expect(calls[0]?.method).toBe("POST");
		expect(calls[0]?.url).toBe(`${BASE}/points/query`);
		expect(calls[0]?.body).toEqual({
			prefetch: [
				{ query: [0.1, 0.2], using: "dense", limit: 3, filter },
				{
					query: {
						text: "sucre",
						model: "qdrant/bm25",
						options: { language: "french", ascii_folding: true }
					},
					using: "bm25",
					limit: 3,
					filter
				}
			],
			query: { rrf: {} },
			limit: 3,
			with_payload: true
		});
	});

	test("defaults the prefetch limit and omits an empty filter", async () => {
		const { client, calls } = createTestClient(() => jsonResponse({ result: { points: [] } }));

		await client.queryHybrid({ dense: [0.1], text: "sucre", limit: 5 });

		expect(calls[0]?.body).toEqual({
			prefetch: [
				{ query: [0.1], using: "dense", limit: 5 },
				{
					query: { text: "sucre", model: "qdrant/bm25" },
					using: "bm25",
					limit: 5
				}
			],
			query: { rrf: {} },
			limit: 5,
			with_payload: true
		});
	});
});

describe("scrollIds", () => {
	test("follows pages until the next offset is absent", async () => {
		const { client, calls } = createTestClient((call) => {
			const offset = (call.body as { offset?: number } | undefined)?.offset;

			if (offset === undefined) {
				return jsonResponse({
					result: {
						points: [{ id: 1 }, { id: 2 }],
						next_page_offset: 2
					}
				});
			}

			return jsonResponse({ result: { points: [{ id: 3 }] } });
		});

		const ids = await client.scrollIds();

		expect(ids).toEqual([1, 2, 3]);
		expect(calls).toHaveLength(2);
		expect(calls[0]?.body).toEqual({
			limit: 256,
			with_payload: false,
			with_vector: false
		});
		expect(calls[1]?.body).toEqual({
			limit: 256,
			with_payload: false,
			with_vector: false,
			offset: 2
		});
	});

	test("applies the filter and the requested page size", async () => {
		const { client, calls } = createTestClient(() => jsonResponse({ result: { points: [] } }));
		const filter = { must: [{ key: "annee", range: { gte: 2004 } }] };

		await client.scrollIds({ filter, pageSize: 10 });

		expect(calls[0]?.body).toEqual({
			limit: 10,
			with_payload: false,
			with_vector: false,
			filter
		});
	});

	test("stops on a null next offset", async () => {
		const { client } = createTestClient(() =>
			jsonResponse({
				result: { points: [{ id: 7 }], next_page_offset: null }
			})
		);

		expect(await client.scrollIds()).toEqual([7]);
	});
});

describe("queryDenseExact", () => {
	test("sends an exact query restricted to the identifiers", async () => {
		const { client, calls } = createTestClient(() =>
			jsonResponse({
				result: {
					points: [
						{ id: 1, score: 1, payload: {} },
						{ id: 5, score: 1, payload: {} }
					]
				}
			})
		);

		const result = await client.queryDenseExact({
			vector: [1, 0],
			ids: [1, 5, 9],
			onMissing: "skip"
		});

		expect(result.scores).toEqual([
			{ id: 1, score: 1 },
			{ id: 5, score: 1 }
		]);
		expect(result.missing).toEqual([9]);
		expect(calls[0]?.body).toEqual({
			query: [1, 0],
			using: "dense",
			filter: { must: [{ has_id: [1, 5, 9] }] },
			params: { exact: true },
			limit: 3,
			with_payload: false
		});
	});

	test("throws on a missing dense vector by default", async () => {
		const { client } = createTestClient(() =>
			jsonResponse({
				result: { points: [{ id: 1, score: 1, payload: {} }] }
			})
		);

		await expect(client.queryDenseExact({ vector: [1, 0], ids: [1, 9] })).rejects.toThrow(
			/no dense vector/s
		);
	});

	test("reports a missing dense vector when the policy is skip", async () => {
		const { client } = createTestClient(() =>
			jsonResponse({
				result: { points: [{ id: 1, score: 1, payload: {} }] }
			})
		);

		const result = await client.queryDenseExact({
			vector: [1, 0],
			ids: [1, 9],
			onMissing: "skip"
		});

		expect(result.missing).toEqual([9]);
	});

	test("returns an empty result for an empty identifier batch", async () => {
		const { client, calls } = createTestClient(() => jsonResponse({ result: { points: [] } }));

		expect(await client.queryDenseExact({ vector: [1], ids: [] })).toEqual({
			scores: [],
			missing: []
		});
		expect(calls).toHaveLength(0);
	});

	test("combines a payload filter with the identifier set", async () => {
		const { client, calls } = createTestClient(() => jsonResponse({ result: { points: [] } }));
		const filter = { must: [{ key: "annee", range: { gte: 2004 } }] };

		await client.queryDenseExact({
			vector: [1],
			ids: [1, 2],
			filter,
			onMissing: "skip"
		});

		expect(calls[0]?.body).toMatchObject({
			filter: {
				must: [{ key: "annee", range: { gte: 2004 } }, { has_id: [1, 2] }]
			}
		});
	});
});

describe("querySparseExact", () => {
	test("sends a BM25 query restricted to the identifiers", async () => {
		const { client, calls } = createTestClient(() =>
			jsonResponse({
				result: {
					points: [
						{ id: 2, score: 1.9, payload: {} },
						{ id: 4, score: 0.7, payload: {} }
					]
				}
			})
		);

		const result = await client.querySparseExact({
			text: "alpha beta",
			bm25Options: { language: "french" },
			ids: [1, 2, 3, 4]
		});

		expect(result.scores).toEqual([
			{ id: 2, score: 1.9 },
			{ id: 4, score: 0.7 }
		]);
		expect(result.missing).toEqual([1, 3]);
		expect(calls[0]?.body).toEqual({
			query: {
				text: "alpha beta",
				model: "qdrant/bm25",
				options: { language: "french" }
			},
			using: "bm25",
			filter: { must: [{ has_id: [1, 2, 3, 4] }] },
			limit: 4,
			with_payload: false
		});
	});

	test("reports sparse nonmatches without throwing", async () => {
		const { client } = createTestClient(() =>
			jsonResponse({
				result: { points: [{ id: 2, score: 1.9, payload: {} }] }
			})
		);

		const result = await client.querySparseExact({
			text: "alpha",
			ids: [1, 2]
		});

		expect(result.missing).toEqual([1]);
	});

	test("preserves the raw score exactly", async () => {
		const { client } = createTestClient(() =>
			jsonResponse({
				result: { points: [{ id: 1, score: 1.905278, payload: {} }] }
			})
		);

		const result = await client.querySparseExact({
			text: "alpha",
			ids: [1]
		});

		expect(result.scores[0]?.score).toBe(1.905278);
	});

	test("returns an empty result for an empty identifier batch", async () => {
		const { client, calls } = createTestClient(() => jsonResponse({ result: { points: [] } }));

		expect(await client.querySparseExact({ text: "alpha", ids: [] })).toEqual({
			scores: [],
			missing: []
		});
		expect(calls).toHaveLength(0);
	});
});

describe("ast vector storage", () => {
	/** Schema with the optional ast multivector, mirroring the dataset wiring of Task 13. */
	const AST_SCHEMA: CollectionSchema = {
		...SCHEMA,
		ast: { name: "ast", size: 256, distance: "Cosine", comparator: "max_sim" }
	};

	/** Qdrant vector description reported by `GET /collections/{name}`. */
	const AST_DESCRIPTION = {
		size: 256,
		distance: "Cosine",
		multivector_config: { comparator: "max_sim" }
	};

	/** Create a client for one schema whose fetch records calls and defers replies. */
	const createClientFor = (schema: CollectionSchema, handler: (call: StubCall) => Response) => {
		const calls: StubCall[] = [];
		const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
			const url =
				typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
			const call: StubCall = {
				method: init?.method ?? "GET",
				url,
				body: init?.body === undefined ? undefined : JSON.parse(String(init.body))
			};
			calls.push(call);

			return handler(call);
		}) as unknown as typeof fetch;
		const client = createQdrantClient(
			schema,
			{ QDRANT_URL: "http://qdrant.test:6333" },
			fetchImpl
		);

		return { client, calls };
	};

	/** Build a collection info body that lists the given named vectors. */
	const collectionInfo = (vectors: Record<string, unknown>): Response =>
		jsonResponse({ result: { config: { params: { vectors } } } });

	/** Build `count` rows of `size` dimensions without materialising the values. */
	const emptyRows = (count: number, size: number): number[][] =>
		Array.from({ length: count }, () => new Array<number>(size));

	describe("ensureAstVector", () => {
		test("adds the named multivector through the documented operation", async () => {
			const { client, calls } = createClientFor(AST_SCHEMA, (call) =>
				call.method === "GET"
					? collectionInfo({ dense: { size: 1024, distance: "Cosine" } })
					: jsonResponse({ result: { operation_id: 1, status: "acknowledged" } })
			);

			expect(await client.ensureAstVector()).toBe(true);
			expect(calls).toHaveLength(2);
			expect(calls[0]).toEqual({ method: "GET", url: BASE, body: undefined });
			expect(calls[1]).toEqual({
				method: "PUT",
				url: `${BASE}/vectors/ast`,
				body: {
					// The body key names the vector *type*, not the vector. The path names the vector.
					dense: {
						size: 256,
						distance: "Cosine",
						multivector_config: { comparator: "max_sim" }
					}
				}
			});
		});

		test("returns false when the collection info already lists the ast vector", async () => {
			const { client, calls } = createClientFor(AST_SCHEMA, () =>
				collectionInfo({
					dense: { size: 1024, distance: "Cosine" },
					ast: AST_DESCRIPTION
				})
			);

			expect(await client.ensureAstVector()).toBe(false);
			expect(calls).toHaveLength(1);
		});

		test("reads an array of named vector descriptions", async () => {
			const { client, calls } = createClientFor(AST_SCHEMA, () =>
				jsonResponse({
					result: {
						config: {
							params: {
								vectors: [
									{ name: "dense", size: 1024, distance: "Cosine" },
									{ name: "ast", ...AST_DESCRIPTION }
								]
							}
						}
					}
				})
			);

			expect(await client.ensureAstVector()).toBe(false);
			expect(calls).toHaveLength(1);
		});

		test("rejects an existing ast vector with a different size", async () => {
			const { client, calls } = createClientFor(AST_SCHEMA, () =>
				collectionInfo({
					dense: { size: 1024, distance: "Cosine" },
					ast: {
						size: 128,
						distance: "Cosine",
						multivector_config: { comparator: "max_sim" }
					}
				})
			);

			await expect(client.ensureAstVector()).rejects.toBeInstanceOf(
				IncompatibleAstVectorError
			);
			expect(calls).toHaveLength(1);
		});

		test("rejects an existing plain dense vector with no multivector configuration", async () => {
			const { client, calls } = createClientFor(AST_SCHEMA, () =>
				collectionInfo({
					dense: { size: 1024, distance: "Cosine" },
					ast: { size: 256, distance: "Cosine" }
				})
			);

			await expect(client.ensureAstVector()).rejects.toBeInstanceOf(
				IncompatibleAstVectorError
			);
			expect(calls).toHaveLength(1);
		});

		test("rejects an existing ast vector with a different comparator", async () => {
			const { client } = createClientFor(AST_SCHEMA, () =>
				collectionInfo({
					ast: {
						size: 256,
						distance: "Cosine",
						multivector_config: { comparator: "other" }
					}
				})
			);

			await expect(client.ensureAstVector()).rejects.toBeInstanceOf(
				IncompatibleAstVectorError
			);
		});

		test("names the vector and both shapes in the incompatibility error", async () => {
			const { client } = createClientFor(AST_SCHEMA, () =>
				collectionInfo({
					ast: {
						size: 128,
						distance: "Cosine",
						multivector_config: { comparator: "max_sim" }
					}
				})
			);

			try {
				await client.ensureAstVector();
				throw new Error("expected IncompatibleAstVectorError");
			} catch (error) {
				expect(error).toBeInstanceOf(IncompatibleAstVectorError);

				const incompatible = error as IncompatibleAstVectorError;

				expect(incompatible.vector).toBe("ast");
				expect(incompatible.expected).toEqual({
					size: 256,
					comparator: "max_sim"
				});
				expect(incompatible.found).toEqual({ size: 128, comparator: "max_sim" });
			}
		});

		test("handles an unnamed single vector description defensively", async () => {
			const { client, calls } = createClientFor(AST_SCHEMA, () =>
				collectionInfo({ size: 1024, distance: "Cosine" })
			);

			expect(await client.ensureAstVector()).toBe(true);
			expect(calls).toHaveLength(2);
			expect(calls[1]?.url).toBe(`${BASE}/vectors/ast`);
		});

		test("uses the schema vector name in the path", async () => {
			const custom: CollectionSchema = {
				...AST_SCHEMA,
				collection: "poems",
				ast: { name: "grammar", size: 128, distance: "Dot", comparator: "max_sim" }
			};
			const { client, calls } = createClientFor(custom, (call) =>
				call.method === "GET" ? collectionInfo({ dense: {} }) : jsonResponse()
			);

			await client.ensureAstVector();

			expect(calls[1]?.url).toBe("http://qdrant.test:6333/collections/poems/vectors/grammar");
			expect(calls[1]?.body).toEqual({
				dense: {
					size: 128,
					distance: "Dot",
					multivector_config: { comparator: "max_sim" }
				}
			});
		});

		test("throws a clear error when the schema has no ast vector", async () => {
			const { client, calls } = createClientFor(SCHEMA, () => jsonResponse());

			await expect(client.ensureAstVector()).rejects.toThrow(/ast/);
			expect(calls).toHaveLength(0);
		});
	});

	describe("updateAstVectors", () => {
		test("updates only the ast vector and waits by default", async () => {
			const { client, calls } = createClientFor(AST_SCHEMA, () => jsonResponse());

			await client.updateAstVectors([
				{
					id: 1,
					rows: [
						[0.1, 0.2],
						[0.3, 0.4]
					]
				},
				{ id: 2, rows: [[0.5, 0.6]] }
			]);

			expect(calls[0]?.method).toBe("PUT");
			expect(calls[0]?.url).toBe(`${BASE}/points/vectors?wait=true`);
			expect(calls[0]?.body).toEqual({
				points: [
					{
						id: 1,
						vector: {
							ast: [
								[0.1, 0.2],
								[0.3, 0.4]
							]
						}
					},
					{ id: 2, vector: { ast: [[0.5, 0.6]] } }
				]
			});
		});

		test("never sends the dense or the sparse vector", async () => {
			const { client, calls } = createClientFor(AST_SCHEMA, () => jsonResponse());

			await client.updateAstVectors([{ id: 7, rows: [[1, 0]] }]);

			const body = calls[0]?.body as { points: Array<{ vector: Record<string, unknown> }> };
			const vector = body.points[0]?.vector ?? {};

			expect(Object.keys(vector)).toEqual(["ast"]);
			expect(vector).not.toHaveProperty("dense");
			expect(vector).not.toHaveProperty("bm25");
		});

		test("honors wait:false", async () => {
			const { client, calls } = createClientFor(AST_SCHEMA, () => jsonResponse());

			await client.updateAstVectors([{ id: 1, rows: [[1, 0]] }], { wait: false });

			expect(calls[0]?.url).toBe(`${BASE}/points/vectors?wait=false`);
		});

		test("sends nothing for an empty update batch", async () => {
			const { client, calls } = createClientFor(AST_SCHEMA, () => jsonResponse());

			await client.updateAstVectors([]);

			expect(calls).toHaveLength(0);
		});

		test("throws when the schema has no ast vector", async () => {
			const { client, calls } = createClientFor(SCHEMA, () => jsonResponse());

			await expect(client.updateAstVectors([{ id: 1, rows: [[1]] }])).rejects.toThrow(/ast/);
			expect(calls).toHaveLength(0);
		});

		test("rejects a row count above the multivector limit without any HTTP call", async () => {
			const { client, calls } = createClientFor(AST_SCHEMA, () => jsonResponse());

			await expect(
				client.updateAstVectors([{ id: 9, rows: emptyRows(4096, 256) }])
			).rejects.toBeInstanceOf(MultiVectorLimitError);
			expect(calls).toHaveLength(0);
		});

		test("names the record, the row count, and the limit in the limit error", async () => {
			const { client } = createClientFor(AST_SCHEMA, () => jsonResponse());

			try {
				await client.updateAstVectors([{ id: 9, rows: emptyRows(4096, 256) }]);
				throw new Error("expected MultiVectorLimitError");
			} catch (error) {
				expect(error).toBeInstanceOf(MultiVectorLimitError);

				const limitError = error as MultiVectorLimitError;

				expect(limitError.id).toBe(9);
				expect(limitError.rows).toBe(4096);
				expect(limitError.size).toBe(256);
				expect(limitError.limit).toBe(MULTIVECTOR_SUBVECTOR_LIMIT);
				expect(limitError.message).toContain("9");
				expect(limitError.message).toContain("4096");
				expect(limitError.message).toContain("1048576");
			}
		});

		test("rejects an empty matrix without any HTTP call", async () => {
			const { client, calls } = createClientFor(AST_SCHEMA, () => jsonResponse());

			await expect(client.updateAstVectors([{ id: 4, rows: [] }])).rejects.toBeInstanceOf(
				MultiVectorValueError
			);
			expect(calls).toHaveLength(0);
		});
	});

	describe("multivector row limit", () => {
		test("exports the documented hard limit", () => {
			expect(MULTIVECTOR_SUBVECTOR_LIMIT).toBe(1_048_576);
		});

		test("computes the maximum row count for one vector size", () => {
			expect(maxMultiVectorRows(256)).toBe(4095);
			expect(maxMultiVectorRows(1024)).toBe(1023);
			expect(maxMultiVectorRows(1)).toBe(1_048_575);
		});

		test("rejects a non-positive row size", () => {
			expect(() => maxMultiVectorRows(0)).toThrow();
			expect(() => maxMultiVectorRows(-256)).toThrow();
			expect(() => maxMultiVectorRows(2.5)).toThrow();
		});

		test("rejects a product equal to the limit", async () => {
			const custom: CollectionSchema = {
				...SCHEMA,
				ast: { name: "ast", size: 524_288, distance: "Cosine", comparator: "max_sim" }
			};
			const { client, calls } = createClientFor(custom, () => jsonResponse());

			await expect(
				client.queryAstExact({ rows: emptyRows(2, 524_288), ids: [1] })
			).rejects.toBeInstanceOf(MultiVectorLimitError);
			expect(calls).toHaveLength(0);
		});
	});

	describe("matrix serialization", () => {
		/** Capture the raw request body text of one call. */
		const rawBodyOf = async (
			call: (client: ReturnType<typeof createQdrantClient>) => Promise<void>
		) => {
			let raw = "";
			const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
				raw = String(init?.body ?? "");

				return jsonResponse({ result: { points: [] } });
			}) as unknown as typeof fetch;
			const client = createQdrantClient(
				AST_SCHEMA,
				{ QDRANT_URL: "http://qdrant.test:6333" },
				fetchImpl
			);

			await call(client);

			return raw;
		};

		test("writes vector values with a decimal point", async () => {
			const raw = await rawBodyOf((client) =>
				client.updateAstVectors([{ id: 1, rows: [[1, 0]] }])
			);

			// Integer-only rows are ambiguous with the legacy sparse form for Qdrant.
			expect(raw).toContain('"ast":[[1.0,0.0]]');
		});

		test("writes the query matrix with a decimal point", async () => {
			const raw = await rawBodyOf((client) =>
				client.queryAstExact({ rows: [[1, 0]], ids: [1], onMissing: "skip" })
			);

			expect(raw).toContain('"query":[[1.0,0.0]]');
		});

		test("rejects a non-finite value before the request", async () => {
			await expect(
				rawBodyOf((client) => client.updateAstVectors([{ id: 1, rows: [[Number.NaN]] }]))
			).rejects.toThrow(/finite/);
		});

		test("raises a typed value error that carries the offending value", async () => {
			try {
				await rawBodyOf((client) =>
					client.updateAstVectors([{ id: 1, rows: [[Number.POSITIVE_INFINITY]] }])
				);
				throw new Error("expected MultiVectorValueError");
			} catch (error) {
				expect(error).toBeInstanceOf(MultiVectorValueError);
				expect((error as MultiVectorValueError).value).toBe(Number.POSITIVE_INFINITY);
			}
		});

		test("serializes a huge finite integer as valid JSON", async () => {
			const raw = await rawBodyOf((client) =>
				client.updateAstVectors([{ id: 1, rows: [[1e21]] }])
			);

			// `Number.isInteger(1e21)` is true but `1e+21.0` is not valid JSON.
			expect(() => JSON.parse(raw)).not.toThrow();
			expect(raw).not.toContain("e+21.0");
		});
	});

	describe("queryAstExact", () => {
		test("sends an exact ast query restricted to the identifiers", async () => {
			const { client, calls } = createClientFor(AST_SCHEMA, () =>
				jsonResponse({
					result: {
						points: [
							{ id: 1, score: 2.0 },
							{ id: 5, score: 0.25 }
						]
					}
				})
			);

			const result = await client.queryAstExact({
				rows: [
					[1, 0],
					[0, 1]
				],
				ids: [1, 5],
				onMissing: "skip"
			});

			expect(result.scores).toEqual([
				{ id: 1, score: 2.0 },
				{ id: 5, score: 0.25 }
			]);
			expect(result.missing).toEqual([]);
			expect(calls[0]?.method).toBe("POST");
			expect(calls[0]?.url).toBe(`${BASE}/points/query`);
			expect(calls[0]?.body).toEqual({
				query: [
					[1, 0],
					[0, 1]
				],
				using: "ast",
				filter: { must: [{ has_id: [1, 5] }] },
				params: { exact: true },
				limit: 2,
				with_payload: false
			});
		});

		test("returns the raw unbounded max_sim score", async () => {
			const { client } = createClientFor(AST_SCHEMA, () =>
				jsonResponse({ result: { points: [{ id: 1, score: 2.0 }] } })
			);

			const result = await client.queryAstExact({
				rows: [
					[1, 0],
					[0, 1]
				],
				ids: [1]
			});

			expect(result.scores[0]?.score).toBe(2.0);
		});

		test("combines a payload filter with the identifier set", async () => {
			const { client, calls } = createClientFor(AST_SCHEMA, () =>
				jsonResponse({ result: { points: [] } })
			);
			const filter = { must: [{ key: "annee", range: { gte: 2004 } }] };

			await client.queryAstExact({
				rows: [[1, 0]],
				ids: [1, 2],
				filter,
				onMissing: "skip"
			});

			expect(calls[0]?.body).toMatchObject({
				filter: {
					must: [{ key: "annee", range: { gte: 2004 } }, { has_id: [1, 2] }]
				}
			});
		});

		test("throws on a missing ast vector by default", async () => {
			const { client } = createClientFor(AST_SCHEMA, () =>
				jsonResponse({ result: { points: [{ id: 1, score: 1 }] } })
			);

			await expect(client.queryAstExact({ rows: [[1, 0]], ids: [1, 9] })).rejects.toThrow(
				/no ast vector/s
			);
		});

		test("reports a missing ast vector with the vector name when the policy is skip", async () => {
			const { client } = createClientFor(AST_SCHEMA, () =>
				jsonResponse({ result: { points: [{ id: 1, score: 1 }] } })
			);

			const result = await client.queryAstExact({
				rows: [[1, 0]],
				ids: [1, 9],
				onMissing: "skip"
			});

			expect(result.missing).toEqual([9]);
			await expect(
				client.queryAstExact({ rows: [[1, 0]], ids: [1, 9] })
			).rejects.toMatchObject({ name: "MissingVectorError", vector: "ast" });
		});

		test("rejects a row count above the multivector limit without any HTTP call", async () => {
			const { client, calls } = createClientFor(AST_SCHEMA, () => jsonResponse());

			await expect(
				client.queryAstExact({ rows: emptyRows(4096, 256), ids: [1] })
			).rejects.toBeInstanceOf(MultiVectorLimitError);
			expect(calls).toHaveLength(0);
		});

		test("rejects an empty query matrix without any HTTP call", async () => {
			const { client, calls } = createClientFor(AST_SCHEMA, () => jsonResponse());

			await expect(client.queryAstExact({ rows: [], ids: [1] })).rejects.toBeInstanceOf(
				MultiVectorValueError
			);
			expect(calls).toHaveLength(0);
		});

		test("returns an empty result for an empty identifier batch", async () => {
			const { client, calls } = createClientFor(AST_SCHEMA, () => jsonResponse());

			expect(await client.queryAstExact({ rows: [[1, 0]], ids: [] })).toEqual({
				scores: [],
				missing: []
			});
			expect(calls).toHaveLength(0);
		});
	});
});

describe("errors", () => {
	test("reports the Qdrant error message and status", async () => {
		const { client } = createTestClient(() => jsonResponse({ status: 500, error: "boom" }));

		await expect(client.ensureCollection()).rejects.toThrow(/500.*boom/s);
	});
});
