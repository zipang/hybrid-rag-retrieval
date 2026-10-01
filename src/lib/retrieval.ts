import type { Bm25Options } from "./bm25"
import type { Embedder } from "./embedder"
import type { PayloadFilter, QdrantClient, QueryHit } from "./qdrant"

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
