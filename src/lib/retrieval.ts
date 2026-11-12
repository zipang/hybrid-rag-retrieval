import type { Bm25Options } from "./bm25";
import type { Embedder } from "./embedder";
import type { IndexStateStore } from "./index-state";
import type { QdrantClient, QueryHit } from "./qdrant";
import type { ResultPageStore, SnapshotBinding } from "./result-pages";
import { createResultPageStore } from "./result-pages";
import type {
	IndexName,
	IndexScores,
	WeightedHit,
	WeightedQuery,
	WeightedResultMetadata,
	WeightedResultPage
} from "./retrieval-contract";
import {
	meetsThreshold,
	NORMALIZATION_VERSION,
	normalizeIndexScore,
	normalizeMultivectorMaxSim,
	scoreAndOrder,
	validateWeights
} from "./scoring";
import { abstractTree, type SyntaxMode } from "./syntax/abstraction";
import { DEFAULT_ENCODER_CONFIG, type EncoderConfig, type encodeTree } from "./syntax/encoder";
import type { Parser } from "./syntax/parser";

/** Dependencies that weighted retrieval needs. Tests inject fakes. */
export type WeightedRetrieverDependencies = {
	/** Dense embedder for the query text. */
	embedder: Pick<Embedder, "embedDenseQuery">;
	/** Qdrant transport operations for the bounded path. */
	client: Pick<QdrantClient, "schema" | "queryVector" | "fetchPayloads">;
	/** BM25 options, shared with ingestion. */
	bm25: Bm25Options;
	/** Index generation label for the result metadata. */
	generation?: string;
	/** Result snapshot store. Defaults to a fresh in-memory store. */
	resultPages?: ResultPageStore;
	/**
	 * Syntax query encoder and its configuration identity.
	 *
	 * Required when a query selects the syntax index. Absent or `undefined` when the caller never
	 * selects syntax.
	 */
	syntax?: {
		/** Parse one text into sentence trees. */
		parser: Parser;
		/** Encode the parsed tree into one vector per sentence. */
		encode: typeof encodeTree;
		/** Encoder configuration. Defaults to `DEFAULT_ENCODER_CONFIG`. */
		encoderConfig?: EncoderConfig;
		/** Syntax mode. The only implemented mode is `coarse`. */
		mode: SyntaxMode;
		/** Configuration identifier published by the backfill. */
		configId: string;
	};
	/** Syntax readiness and generation checks. Required when syntax is selected. */
	state?: Pick<IndexStateStore, "assertSyntaxReady">;
};

/** Weighted retriever bound to one embedder and one Qdrant collection. */
export type WeightedRetriever = {
	/** Score every eligible record and return those at or above the threshold. */
	retrieveWeighted: (query: WeightedQuery) => Promise<WeightedResultPage>;
};

/** Default candidate count requested from Qdrant for each selected index. */
const DEFAULT_CANDIDATE_LIMIT = 50;

/** Smallest accepted candidate count. */
const MIN_CANDIDATE_LIMIT = 1;

/** Largest accepted candidate count. */
const MAX_CANDIDATE_LIMIT = 1000;

/**
 * Clamp the candidate count into the documented bounds.
 *
 * An absent or nonfinite value falls back to {@link DEFAULT_CANDIDATE_LIMIT}. A fractional value is
 * truncated, then clamped into `[1, 1000]`.
 */
const resolveCandidateLimit = (limit: number | undefined): number => {
	if (limit === undefined || !Number.isFinite(limit)) {
		return DEFAULT_CANDIDATE_LIMIT;
	}

	return Math.min(MAX_CANDIDATE_LIMIT, Math.max(MIN_CANDIDATE_LIMIT, Math.floor(limit)));
};

/** The syntax dependency pair, resolved when a query selects the syntax index. */
type ResolvedSyntaxDependency = {
	/** Syntax parser, encoder, mode, and configuration identity. */
	syntax: NonNullable<WeightedRetrieverDependencies["syntax"]>;
	/** Syntax readiness and generation checks. */
	state: NonNullable<WeightedRetrieverDependencies["state"]>;
};

/**
 * Resolve the syntax dependencies when a query selects the syntax index.
 *
 * Returns `undefined` when the query does not select syntax, so the caller never reads the parser
 * or the state. Throws when syntax is selected but either dependency is absent.
 */
const resolveSyntaxDependency = (
	dependencies: WeightedRetrieverDependencies,
	usesSyntax: boolean
): ResolvedSyntaxDependency | undefined => {
	if (!usesSyntax) {
		return undefined;
	}

	const syntax = dependencies.syntax;
	const state = dependencies.state;

	if (syntax === undefined || state === undefined) {
		throw new Error("the syntax index is selected but the syntax dependencies are missing");
	}

	return { syntax, state };
};

/**
 * Create a weighted threshold retriever.
 *
 * The retriever asks Qdrant for a bounded candidate set. It runs one bounded query per selected
 * index, each with the same candidate `limit`, unions the returned identifiers, and scores only
 * those candidates. The work is bounded by `limit` and never by the collection size.
 *
 * One query selects any subset of `syntax`, `semantic`, and `keyword` by weight. The `syntax` index
 * adds a query-side parse and encode and a readiness check. A query that does not select syntax
 * reads none of the syntax dependencies.
 *
 * When the query selects the syntax index, the readiness check runs before any transport query:
 *
 * - A generation that is absent or changed fails with `StaleGenerationError`;
 * - A generation that exists but has no ready syntax run fails with `SyntaxNotReadyError`.
 *
 * A candidate that one index did not return contributes a zero component score for that index. At
 * `minScore = 0` it can still qualify on its other indexes.
 */
export const createWeightedRetriever = (
	dependencies: WeightedRetrieverDependencies
): WeightedRetriever => {
	const resultPages = dependencies.resultPages ?? createResultPageStore();

	const retrieveWeighted = async (query: WeightedQuery): Promise<WeightedResultPage> => {
		const validation = validateWeights(query.weights);

		if (!validation.valid) {
			throw new Error(`invalid weights: ${validation.reason}`);
		}

		const weights = validation.weights;

		if (!Number.isFinite(query.minScore) || query.minScore < 0 || query.minScore > 1) {
			throw new Error("minScore must be a finite number in [0, 1]");
		}

		const generation = query.generation ?? dependencies.generation ?? "unknown";
		const usesSyntax = weights.syntax > 0;
		const metadata: WeightedResultMetadata = {
			weights,
			minScore: query.minScore,
			normalizationVersion: NORMALIZATION_VERSION,
			generation
		};
		const binding: SnapshotBinding = {
			text: query.text,
			weights,
			minScore: query.minScore,
			generation
		};

		if (query.filters !== undefined) {
			binding.filters = query.filters;
		}

		if (query.text.trim() === "") {
			return { results: [], metadata };
		}

		const syntaxDependency = resolveSyntaxDependency(dependencies, usesSyntax);

		if (syntaxDependency !== undefined) {
			metadata.syntaxConfigId = syntaxDependency.syntax.configId;
		}

		const filter = query.filters;
		const limit = resolveCandidateLimit(query.limit);

		if (query.cursor !== undefined) {
			const page = resultPages.read({
				binding,
				cursor: query.cursor,
				...(query.pageSize === undefined ? {} : { pageSize: query.pageSize })
			});

			return {
				results: await toWeightedHits(dependencies.client, page.records),
				...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
				metadata
			};
		}

		// Resolve the readiness of the syntax index, then encode the query text once, before the
		// bounded queries. A missing, pending, or mismatched state reaches the caller unchanged.
		let syntaxRows: number[][] | undefined;

		if (syntaxDependency !== undefined) {
			const { syntax, state } = syntaxDependency;

			await state.assertSyntaxReady(generation, syntax.configId);

			const parsed = await syntax.parser.parse(query.text);
			const tree = abstractTree(parsed, syntax.mode);
			const vectors = syntax.encode(tree, syntax.encoderConfig ?? DEFAULT_ENCODER_CONFIG);

			syntaxRows = vectors.map((vector) => vector.values);
		}

		const schema = dependencies.client.schema;
		const scoresById = new Map<number | string, IndexScores>();
		const candidateIds = new Set<number | string>();

		/**
		 * Merge one index's bounded hits into the candidate set and the score map.
		 *
		 * `normalize` maps one raw index score into `[0, 1]`. Each index supplies its own
		 * transformation, so the syntax divisor never leaks into the per-score indexes.
		 */
		const mergeHits = (
			index: IndexName,
			hits: Array<Pick<QueryHit, "id" | "score">>,
			normalize: (raw: number) => number
		): void => {
			for (const hit of hits) {
				candidateIds.add(hit.id);

				const scores = scoresById.get(hit.id) ?? {};

				scores[index] = normalize(hit.score);
				scoresById.set(hit.id, scores);
			}
		};

		if (syntaxRows !== undefined) {
			const astName = schema.ast?.name;

			if (astName === undefined) {
				throw new Error(
					"the syntax index is selected but the collection schema has no ast vector"
				);
			}

			const hits = await dependencies.client.queryVector({
				using: astName,
				query: syntaxRows,
				limit,
				filter
			});

			mergeHits("syntax", hits, (raw) =>
				normalizeMultivectorMaxSim(raw, syntaxRows.length, syntaxRows.length)
			);
		}

		if (weights.semantic > 0) {
			const dense = await dependencies.embedder.embedDenseQuery(query.text);
			const hits = await dependencies.client.queryVector({
				using: schema.dense.name,
				query: dense,
				limit,
				filter
			});

			mergeHits("semantic", hits, (raw) => normalizeIndexScore("semantic", raw));
		}

		if (weights.keyword > 0) {
			const hits = await dependencies.client.queryVector({
				using: schema.sparse.name,
				query: { text: query.text, model: "qdrant/bm25", options: dependencies.bm25 },
				limit,
				filter
			});

			mergeHits("keyword", hits, (raw) => normalizeIndexScore("keyword", raw));
		}

		if (candidateIds.size === 0) {
			return { results: [], metadata };
		}

		const scored = scoreAndOrder(
			weights,
			[...candidateIds].map((id) => {
				const entry = scoresById.get(id) ?? {};

				return {
					id,
					scores: {
						syntax: entry.syntax ?? 0,
						semantic: entry.semantic ?? 0,
						keyword: entry.keyword ?? 0
					}
				};
			})
		);

		const ranking = scored.filter((record) => meetsThreshold(record.score, query.minScore));
		const snapshot = resultPages.create(ranking, binding);
		const page = resultPages.read({
			snapshotId: snapshot.id,
			binding,
			...(query.pageSize === undefined ? {} : { pageSize: query.pageSize })
		});

		return {
			results: await toWeightedHits(dependencies.client, page.records),
			...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
			metadata
		};
	};

	return { retrieveWeighted };
};

/**
 * Map scored records to weighted hits and attach their payloads.
 *
 * The function reads the payloads for the delivered page only. It keeps the transport lean and
 * keeps dataset field names out of the scoring loop.
 */
const toWeightedHits = async (
	client: Pick<QdrantClient, "fetchPayloads">,
	records: Array<{ id: number | string; score: number; scores?: IndexScores }>
): Promise<WeightedHit[]> => {
	if (records.length === 0) {
		return [];
	}

	const payloads = await client.fetchPayloads(records.map((record) => record.id));

	return records.map((record) => ({
		id: record.id,
		score: record.score,
		scores: record.scores ?? {},
		payload: payloads.get(record.id) ?? {}
	}));
};
