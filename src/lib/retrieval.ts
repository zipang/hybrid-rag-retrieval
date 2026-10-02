import type { Bm25Options } from "./bm25"
import type { Embedder } from "./embedder"
import type { PayloadFilter, QdrantClient } from "./qdrant"
import type { ResultPageStore, SnapshotBinding } from "./result-pages"
import { createResultPageStore } from "./result-pages"
import type {
	IndexScores,
	WeightedHit,
	WeightedQuery,
	WeightedResultPage,
} from "./retrieval-contract"
import {
	meetsThreshold,
	NORMALIZATION_VERSION,
	normalizeBm25,
	normalizeCosine,
	scoreAndOrder,
	validateWeights,
} from "./scoring"

/** Dependencies that weighted retrieval needs. Tests inject fakes. */
export type WeightedRetrieverDependencies = {
	/** Dense embedder for the query text. */
	embedder: Pick<Embedder, "embedDenseQuery">
	/** Qdrant transport operations for the exhaustive path. */
	client: Pick<QdrantClient, "scrollIds" | "fetchPayloads" | "queryDenseExact" | "querySparseExact">
	/** BM25 options, shared with ingestion. */
	bm25: Bm25Options
	/** Identifier batch size for exact score queries. Defaults to `DEFAULT_ID_BATCH`. */
	idBatchSize?: number
	/** Index generation label for the result metadata. */
	generation?: string
	/** Result snapshot store. Defaults to a fresh in-memory store. */
	resultPages?: ResultPageStore
	/** Payload field name for the year range filter. */
	filterField: string
}

/** Weighted retriever bound to one embedder and one Qdrant collection. */
export type WeightedRetriever = {
	/** Score every eligible record and return those at or above the threshold. */
	retrieveWeighted: (query: WeightedQuery) => Promise<WeightedResultPage>
}

/** Default number of identifiers per exact score request. */
const DEFAULT_ID_BATCH = 128

/** Split a list into fixed-size batches. */
const batch = <T>(items: T[], size: number): T[][] => {
	if (size <= 0) {
		return [items]
	}

	const batches: T[][] = []

	for (let index = 0; index < items.length; index += size) {
		batches.push(items.slice(index, index + size))
	}

	return batches
}

/** Build the year-range payload filter, or `undefined` when no bound is set. */
const buildFilter = (query: WeightedQuery, field: string): PayloadFilter | undefined => {
	const range: { gte?: number; lte?: number } = {}

	if (query.filters?.yearFrom !== undefined) {
		range.gte = query.filters.yearFrom
	}

	if (query.filters?.yearTo !== undefined) {
		range.lte = query.filters.yearTo
	}

	if (range.gte === undefined && range.lte === undefined) {
		return undefined
	}

	return { must: [{ key: field, range }] }
}

/**
 * Create a weighted threshold retriever.
 *
 * The semantic-only slice scores every eligible identifier. It scrolls the
 * matching identifier set, requests exact dense scores in identifier batches,
 * and converts each cosine value with `max(0, min(1, cosine))`. It never uses a
 * top-K cutoff, so a moderate score outside a small candidate list still
 * qualifies. The function keeps scoring and qualification apart, so pagination
 * can reuse the stable order in a later task.
 *
 * This slice supports the `semantic` index. A query with a positive `syntax` or
 * `keyword` weight is rejected until the later tasks add those indexes.
 */
export const createWeightedRetriever = (
	dependencies: WeightedRetrieverDependencies,
): WeightedRetriever => {
	const idBatchSize = dependencies.idBatchSize ?? DEFAULT_ID_BATCH
	const resultPages = dependencies.resultPages ?? createResultPageStore()

	const retrieveWeighted = async (query: WeightedQuery): Promise<WeightedResultPage> => {
		const validation = validateWeights(query.weights)

		if (!validation.valid) {
			throw new Error(`invalid weights: ${validation.reason}`)
		}

		const weights = validation.weights

		if (weights.syntax > 0) {
			throw new Error("the syntax index is not available in this retrieval slice")
		}

		if (!Number.isFinite(query.minScore) || query.minScore < 0 || query.minScore > 1) {
			throw new Error("minScore must be a finite number in [0, 1]")
		}

		const generation = query.generation ?? dependencies.generation ?? "unknown"
		const metadata = {
			weights,
			minScore: query.minScore,
			normalizationVersion: NORMALIZATION_VERSION,
			generation,
		}
		const binding: SnapshotBinding = {
			text: query.text,
			weights,
			minScore: query.minScore,
			generation,
		}

		if (query.filters !== undefined) {
			binding.filters = query.filters
		}

		if (query.text.trim() === "") {
			return { results: [], metadata }
		}

		const filter = buildFilter(query, dependencies.filterField)

		if (query.cursor !== undefined) {
			const page = resultPages.read({
				binding,
				cursor: query.cursor,
				...(query.pageSize === undefined ? {} : { pageSize: query.pageSize }),
			})

			return {
				results: await toWeightedHits(dependencies.client, page.records),
				...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
				metadata,
			}
		}

		const ids = await dependencies.client.scrollIds({ filter })

		if (ids.length === 0) {
			return { results: [], metadata }
		}

		const semantic = new Map<number | string, number>()
		const keyword = new Map<number | string, number>()

		if (weights.semantic > 0) {
			const dense = await dependencies.embedder.embedDenseQuery(query.text)

			for (const idBatch of batch(ids, idBatchSize)) {
				const result = await dependencies.client.queryDenseExact({
					vector: dense,
					ids: idBatch,
					filter,
				})

				for (const entry of result.scores) {
					semantic.set(entry.id, normalizeCosine(entry.score))
				}
			}
		}

		if (weights.keyword > 0) {
			for (const idBatch of batch(ids, idBatchSize)) {
				const result = await dependencies.client.querySparseExact({
					text: query.text,
					bm25Options: dependencies.bm25,
					ids: idBatch,
					filter,
				})

				for (const entry of result.scores) {
					keyword.set(entry.id, normalizeBm25(entry.score))
				}
			}
		}

		const scored = scoreAndOrder(
			weights,
			ids.map((id) => ({
				id,
				scores: {
					semantic: semantic.get(id) ?? 0,
					keyword: keyword.get(id) ?? 0,
				},
			})),
		)

		const ranking = scored.filter((record) => meetsThreshold(record.score, query.minScore))
		const snapshot = resultPages.create(ranking, binding)
		const page = resultPages.read({
			snapshotId: snapshot.id,
			binding,
			...(query.pageSize === undefined ? {} : { pageSize: query.pageSize }),
		})

		return {
			results: await toWeightedHits(dependencies.client, page.records),
			...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
			metadata,
		}
	}

	return { retrieveWeighted }
}

/**
 * Map scored records to weighted hits and attach their payloads.
 *
 * The function reads the payloads for the delivered page only. It keeps the
 * transport lean and keeps dataset field names out of the scoring loop.
 */
const toWeightedHits = async (
	client: Pick<QdrantClient, "fetchPayloads">,
	records: Array<{ id: number | string; score: number; scores?: IndexScores }>,
): Promise<WeightedHit[]> => {
	if (records.length === 0) {
		return []
	}

	const payloads = await client.fetchPayloads(records.map((record) => record.id))

	return records.map((record) => ({
		id: record.id,
		score: record.score,
		scores: record.scores ?? {},
		payload: payloads.get(record.id) ?? {},
	}))
}
