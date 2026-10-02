import type { Bm25Options } from "./bm25"
import type { Embedder } from "./embedder"
import type { PayloadFilter, QdrantClient, QueryHit } from "./qdrant"
import type { WeightedHit, WeightedQuery, WeightedResultPage } from "./retrieval-contract"
import {
	meetsThreshold,
	NORMALIZATION_VERSION,
	normalizeCosine,
	scoreAndOrder,
	validateWeights,
} from "./scoring"

/** Dependencies that hybrid retrieval needs. Tests inject fakes. */
export type RetrieverDependencies = {
	/** Dense embedder for the query text. */
	embedder: Pick<Embedder, "embedDenseQuery">
	/** Qdrant hybrid query operation. */
	client: Pick<QdrantClient, "queryHybrid">
	/** BM25 options, shared with ingestion. */
	bm25: Bm25Options
}

/** Ranking options for one retrieval. */
export type RetrievalOptions = {
	/** Maximum number of fused results. Defaults to `DEFAULT_TOP_K`. */
	topK?: number
	/** Lower bound on the publication year, inclusive. */
	yearFrom?: number
	/** Upper bound on the publication year, inclusive. */
	yearTo?: number
}

/** One ranked slogan returned by hybrid retrieval. */
export type SloganHit = {
	/** Fused RRF score. */
	score: number
	/** Record identifier. */
	id: number | string
	/** Publication year. */
	annee: number
	/** Brand or issuing organization. */
	marque: string
	/** Campaign name, or an empty string. */
	campagne: string
	/** Slogan text. */
	slogan: string
}

/** Hybrid retriever bound to one embedder and one Qdrant collection. */
export type Retriever = {
	/** Search the slogan collection with a dense + BM25 hybrid query. */
	retrieveHybrid: (query: string, options?: RetrievalOptions) => Promise<SloganHit[]>
}

/** Default number of fused results. */
const DEFAULT_TOP_K = 5

/** Prefetch candidates per retriever, as a multiple of `topK`. */
const PREFETCH_FACTOR = 4

/** Build the year-range payload filter, or `undefined` when no bound is set. */
const buildYearFilter = (options: RetrievalOptions): PayloadFilter | undefined => {
	const range: { gte?: number; lte?: number } = {}

	if (options.yearFrom !== undefined) {
		range.gte = options.yearFrom
	}

	if (options.yearTo !== undefined) {
		range.lte = options.yearTo
	}

	if (range.gte === undefined && range.lte === undefined) {
		return undefined
	}

	return { must: [{ key: "annee", range }] }
}

/** Read one payload field as a string. */
const readString = (payload: Record<string, unknown>, key: string): string => {
	const value = payload[key]

	return typeof value === "string" ? value : ""
}

/** Read one payload field as a number. */
const readNumber = (payload: Record<string, unknown>, key: string): number => {
	const value = payload[key]

	return typeof value === "number" ? value : 0
}

/** Read the record identifier from the payload, or fall back to the point id. */
const readIdentifier = (hit: QueryHit): number | string => {
	const value = hit.payload.id

	return typeof value === "number" || typeof value === "string" ? value : hit.id
}

/** Map one Qdrant hit to a typed slogan hit. */
const toSloganHit = (hit: QueryHit): SloganHit => ({
	score: hit.score,
	id: readIdentifier(hit),
	annee: readNumber(hit.payload, "annee"),
	marque: readString(hit.payload, "marque"),
	campagne: readString(hit.payload, "campagne"),
	slogan: readString(hit.payload, "slogan"),
})

/**
 * Create a hybrid retriever over the slogan collection.
 *
 * The retriever embeds the query client-side and sends one Query API request
 * with a dense prefetch and a BM25 prefetch. Qdrant fuses both with RRF. A
 * blank query or a zero-hit result returns an empty list.
 */
export const createRetriever = (dependencies: RetrieverDependencies): Retriever => {
	const retrieveHybrid = async (
		query: string,
		options: RetrievalOptions = {},
	): Promise<SloganHit[]> => {
		if (query.trim() === "") {
			return []
		}

		const topK = options.topK ?? DEFAULT_TOP_K
		const dense = await dependencies.embedder.embedDenseQuery(query)
		const hits = await dependencies.client.queryHybrid({
			dense,
			text: query,
			bm25Options: dependencies.bm25,
			limit: topK,
			prefetchLimit: topK * PREFETCH_FACTOR,
			filter: buildYearFilter(options),
		})

		return hits.map(toSloganHit)
	}

	return { retrieveHybrid }
}

/** Dependencies that weighted retrieval needs. Tests inject fakes. */
export type WeightedRetrieverDependencies = {
	/** Dense embedder for the query text. */
	embedder: Pick<Embedder, "embedDenseQuery">
	/** Qdrant transport operations for the exhaustive path. */
	client: Pick<QdrantClient, "scrollIds" | "queryDenseExact" | "querySparseExact">
	/** BM25 options, shared with ingestion. */
	bm25: Bm25Options
	/** Identifier batch size for exact score queries. Defaults to `DEFAULT_ID_BATCH`. */
	idBatchSize?: number
	/** Index generation label for the result metadata. */
	generation?: string
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
const buildFilter = (query: WeightedQuery): PayloadFilter | undefined => {
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

	return { must: [{ key: "annee", range }] }
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

	const retrieveWeighted = async (query: WeightedQuery): Promise<WeightedResultPage> => {
		const validation = validateWeights(query.weights)

		if (!validation.valid) {
			throw new Error(`invalid weights: ${validation.reason}`)
		}

		const weights = validation.weights

		if (weights.syntax > 0 || weights.keyword > 0) {
			throw new Error("this retrieval slice supports the semantic index only")
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

		if (query.text.trim() === "") {
			return { results: [], metadata }
		}

		const filter = buildFilter(query)
		const ids = await dependencies.client.scrollIds({ filter })

		if (ids.length === 0) {
			return { results: [], metadata }
		}

		const dense = await dependencies.embedder.embedDenseQuery(query.text)
		const cosines = new Map<number | string, number>()

		for (const idBatch of batch(ids, idBatchSize)) {
			const result = await dependencies.client.queryDenseExact({
				vector: dense,
				ids: idBatch,
				filter,
			})

			for (const entry of result.scores) {
				cosines.set(entry.id, entry.score)
			}
		}

		const scored = scoreAndOrder(
			weights,
			ids.map((id) => ({
				id,
				scores: { semantic: normalizeCosine(cosines.get(id) ?? 0) },
			})),
		)

		const ranking = scored.filter((record) => meetsThreshold(record.score, query.minScore))
		const pageSize = query.pageSize ?? ranking.length
		const page = ranking.slice(0, pageSize)
		const results: WeightedHit[] = page.map((record) => ({
			id: record.id,
			score: record.score,
			scores: { semantic: normalizeCosine(cosines.get(record.id) ?? 0) },
			annee: 0,
			marque: "",
			campagne: "",
			slogan: "",
		}))

		const remaining = ranking.length - page.length

		if (remaining > 0) {
			return { results, nextCursor: String(page.length), metadata }
		}

		return { results, metadata }
	}

	return { retrieveWeighted }
}
