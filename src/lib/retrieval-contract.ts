/**
 * Shared types for weighted threshold retrieval.
 *
 * These types separate the four quantities that the T0004 contract keeps apart:
 * index weights, per-index component scores, the combined score, and the
 * paginated result. They also carry the index generation. The generation binds a
 * score to one corpus and one scoring configuration, so a score from one
 * generation never mixes with a score from another.
 */

/** The three indexes that a weighted query can select. */
export type IndexName = "syntax" | "semantic" | "keyword"

/** Every index name, in a fixed order. */
export const INDEX_NAMES: readonly IndexName[] = ["syntax", "semantic", "keyword"]

/** Fractional contribution weights, one entry per selected index. */
export type IndexWeights = Partial<Record<IndexName, number>>

/** Strict version of {@link IndexWeights} with every index present. */
export type FullIndexWeights = Record<IndexName, number>

/** Finite component scores in `[0, 1]`, one entry per selected index. */
export type IndexScores = Partial<Record<IndexName, number>>

/** Filters that select eligible records before qualification. */
export type RetrievalFilters = {
	/** Lower bound on the publication year, inclusive. */
	yearFrom?: number
	/** Upper bound on the publication year, inclusive. */
	yearTo?: number
}

/** One query for weighted threshold retrieval. */
export type WeightedQuery = {
	/** Query text. Keyword and syntax indexes use it as-is. */
	text: string
	/** Fractional weights. The sum must be `1` within the tolerance. */
	weights: IndexWeights
	/** Minimum combined score that a record must meet. Inclusive. */
	minScore: number
	/** Delivery size for one page. It does not change match eligibility. */
	pageSize?: number
	/** Opaque continuation token from a previous page. */
	cursor?: string
	/** Payload filters applied before qualification. */
	filters?: RetrievalFilters
	/** Index generation that the query targets. */
	generation?: string
}

/** One scored record in a weighted result page. */
export type WeightedHit = {
	/** Record identifier. */
	id: number | string
	/** Combined matching score. */
	score: number
	/** Selected per-index component scores. */
	scores: IndexScores
	/** Publication year. */
	annee: number
	/** Brand or issuing organization. */
	marque: string
	/** Campaign name, or an empty string. */
	campagne: string
	/** Slogan text. */
	slogan: string
}

/** Metadata that describes how one result page was scored. */
export type WeightedResultMetadata = {
	/** Normalized weights actually applied. */
	weights: FullIndexWeights
	/** Applied minimum combined score. */
	minScore: number
	/** Version of the normalization formulas. */
	normalizationVersion: string
	/** Index generation of the corpus and the scoring configuration. */
	generation: string
	/** Syntax profile identifier, when syntax is selected. */
	syntaxConfigId?: string
}

/** One page of weighted results. */
export type WeightedResultPage = {
	/** Qualifying records, ordered by combined score descending. */
	results: WeightedHit[]
	/** Opaque token for the next page, or `undefined` on the last page. */
	nextCursor?: string
	/** Scoring metadata for this page. */
	metadata: WeightedResultMetadata
}
