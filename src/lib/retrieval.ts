import type { Bm25Options } from "./bm25";
import type { Embedder } from "./embedder";
import type { IndexStateStore } from "./index-state";
import type { QdrantClient } from "./qdrant";
import type { ResultPageStore, SnapshotBinding } from "./result-pages";
import { createResultPageStore } from "./result-pages";
import type {
	IndexScores,
	WeightedHit,
	WeightedQuery,
	WeightedResultMetadata,
	WeightedResultPage
} from "./retrieval-contract";
import {
	meetsThreshold,
	NORMALIZATION_VERSION,
	normalizeBm25,
	normalizeCosine,
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
	/** Qdrant transport operations for the exhaustive path. */
	client: Pick<
		QdrantClient,
		"scrollIds" | "fetchPayloads" | "queryDenseExact" | "querySparseExact" | "queryAstExact"
	>;
	/** BM25 options, shared with ingestion. */
	bm25: Bm25Options;
	/** Identifier batch size for exact score queries. Defaults to `DEFAULT_ID_BATCH`. */
	idBatchSize?: number;
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

/** Default number of identifiers per exact score request. */
const DEFAULT_ID_BATCH = 128;

/** Split a list into fixed-size batches. */
const batch = <T>(items: T[], size: number): T[][] => {
	if (size <= 0) {
		return [items];
	}

	const batches: T[][] = [];

	for (let index = 0; index < items.length; index += size) {
		batches.push(items.slice(index, index + size));
	}

	return batches;
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
 * The retriever scores every eligible identifier. It scrolls the matching identifier set, requests
 * exact scores in identifier batches, and normalizes each index into `[0, 1]`. It never uses a
 * top-K cutoff, so a moderate score outside a small candidate list still qualifies. The function
 * keeps scoring and qualification apart, so pagination can reuse the stable order.
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
 * A record without an `ast` vector contributes a zero syntax component score. It is not removed
 * from the candidate set, so at `minScore = 0` it can still qualify on its other indexes.
 */
export const createWeightedRetriever = (
	dependencies: WeightedRetrieverDependencies
): WeightedRetriever => {
	const idBatchSize = dependencies.idBatchSize ?? DEFAULT_ID_BATCH;
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
		// identifier batches. A missing, pending, or mismatched state reaches the caller unchanged.
		let syntaxRows: number[][] | undefined;

		if (syntaxDependency !== undefined) {
			const { syntax, state } = syntaxDependency;

			await state.assertSyntaxReady(generation, syntax.configId);

			const parsed = await syntax.parser.parse(query.text);
			const tree = abstractTree(parsed, syntax.mode);
			const vectors = syntax.encode(tree, syntax.encoderConfig ?? DEFAULT_ENCODER_CONFIG);

			syntaxRows = vectors.map((vector) => vector.values);
		}

		const ids = await dependencies.client.scrollIds({ filter });

		if (ids.length === 0) {
			return { results: [], metadata };
		}

		const syntaxScores = new Map<number | string, number>();
		const semantic = new Map<number | string, number>();
		const keyword = new Map<number | string, number>();

		if (syntaxRows !== undefined) {
			for (const idBatch of batch(ids, idBatchSize)) {
				const result = await dependencies.client.queryAstExact({
					rows: syntaxRows,
					ids: idBatch,
					filter,
					withRows: true,
					onMissing: "skip"
				});

				for (const entry of result.scores) {
					if (entry.rows === undefined) {
						throw new Error(
							`the ast transport reported no row count for record ${String(entry.id)}`
						);
					}

					syntaxScores.set(
						entry.id,
						normalizeMultivectorMaxSim(entry.score, syntaxRows.length, entry.rows)
					);
				}
			}
		}

		if (weights.semantic > 0) {
			const dense = await dependencies.embedder.embedDenseQuery(query.text);

			for (const idBatch of batch(ids, idBatchSize)) {
				const result = await dependencies.client.queryDenseExact({
					vector: dense,
					ids: idBatch,
					filter
				});

				for (const entry of result.scores) {
					semantic.set(entry.id, normalizeCosine(entry.score));
				}
			}
		}

		if (weights.keyword > 0) {
			for (const idBatch of batch(ids, idBatchSize)) {
				const result = await dependencies.client.querySparseExact({
					text: query.text,
					bm25Options: dependencies.bm25,
					ids: idBatch,
					filter
				});

				for (const entry of result.scores) {
					keyword.set(entry.id, normalizeBm25(entry.score));
				}
			}
		}

		const scored = scoreAndOrder(
			weights,
			ids.map((id) => ({
				id,
				scores: {
					syntax: syntaxScores.get(id) ?? 0,
					semantic: semantic.get(id) ?? 0,
					keyword: keyword.get(id) ?? 0
				}
			}))
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
