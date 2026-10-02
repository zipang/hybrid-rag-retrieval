/**
 * Legacy hybrid retrieval over the slogan collection.
 *
 * This module holds the pre-T0004 hybrid path: one dense prefetch and one BM25
 * prefetch fused by Qdrant RRF, mapped to typed slogan hits. The T0004 weighted
 * contract in `src/lib/retrieval.ts` replaces it. The project keeps this module
 * until the caller migration (Tasks 15 and 16) completes, so the current chat
 * and UI callers keep working.
 *
 * The retriever takes a field configuration, so it carries no slogan field name
 * of its own. The slogan configuration lives at the call site.
 */

import type { Bm25Options } from "./bm25"
import type { Embedder } from "./embedder"
import type { PayloadFilter, QdrantClient, QueryHit } from "./qdrant"

/** Payload field names that map one record to a typed hit. */
export type HitFields = {
	/** Numeric field for the year filter and the year output. */
	year: string
	/** String field for the brand or organization output. */
	brand: string
	/** String field for the campaign output. */
	campaign: string
	/** String field for the content output. */
	content: string
}

/** Dependencies that the legacy hybrid retriever needs. Tests inject fakes. */
export type RetrieverDependencies = {
	/** Dense embedder for the query text. */
	embedder: Pick<Embedder, "embedDenseQuery">
	/** Qdrant hybrid query operation. */
	client: Pick<QdrantClient, "queryHybrid">
	/** BM25 options, shared with ingestion. */
	bm25: Bm25Options
	/** Payload field names for filters and typed output. */
	fields: HitFields
}

/** Ranking options for one legacy retrieval. */
export type RetrievalOptions = {
	/** Maximum number of fused results. Defaults to `DEFAULT_TOP_K`. */
	topK?: number
	/** Lower bound on the year field, inclusive. */
	yearFrom?: number
	/** Upper bound on the year field, inclusive. */
	yearTo?: number
}

/** One ranked record returned by the legacy hybrid retrieval. */
export type SloganHit = {
	/** Fused RRF score. */
	score: number
	/** Record identifier. */
	id: number | string
	/** Value of the configured year field. */
	annee: number
	/** Value of the configured brand field. */
	marque: string
	/** Value of the configured campaign field. */
	campagne: string
	/** Value of the configured content field. */
	slogan: string
}

/** Legacy hybrid retriever bound to one embedder and one Qdrant collection. */
export type Retriever = {
	/** Search the collection with a dense + BM25 hybrid query. */
	retrieveHybrid: (query: string, options?: RetrievalOptions) => Promise<SloganHit[]>
}

/** Default number of fused results. */
const DEFAULT_TOP_K = 5

/** Prefetch candidates per retriever, as a multiple of `topK`. */
const PREFETCH_FACTOR = 4

/** Build the year-range payload filter, or `undefined` when no bound is set. */
const buildYearFilter = (options: RetrievalOptions, field: string): PayloadFilter | undefined => {
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

	return { must: [{ key: field, range }] }
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

/** Map one Qdrant hit to a typed hit with the configured field names. */
const toTypedHit = (hit: QueryHit, fields: HitFields): SloganHit => ({
	score: hit.score,
	id: readIdentifier(hit),
	annee: readNumber(hit.payload, fields.year),
	marque: readString(hit.payload, fields.brand),
	campagne: readString(hit.payload, fields.campaign),
	slogan: readString(hit.payload, fields.content),
})

/**
 * Create a legacy hybrid retriever over one collection.
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
			filter: buildYearFilter(options, dependencies.fields.year),
		})

		return hits.map((hit) => toTypedHit(hit, dependencies.fields))
	}

	return { retrieveHybrid }
}
