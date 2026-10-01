/** Environment variables that configure Qdrant's native BM25 inference. */
export type Bm25Env = {
	/** Stemming and stopword language for BM25. */
	BM25_LANGUAGE?: string
	/** Enable diacritic-insensitive matching (`"true"` or `"false"`). */
	BM25_ASCII_FOLDING?: string
	/** Average content length in words for BM25 length normalization. */
	BM25_AVG_LEN?: string
	/** Extra environment values, so `process.env` is assignable. */
	[key: string]: string | undefined
}

/** Options for Qdrant's `qdrant/bm25` model. */
export type Bm25Options = {
	/** Stemming and stopword language. */
	language?: string
	/** Enable diacritic-insensitive matching. */
	ascii_folding?: boolean
	/** Average content length in words. */
	avg_len?: number
}

/**
 * Build the Qdrant BM25 options from the environment.
 *
 * Qdrant requires the same options at ingest time and at query time. Both the
 * indexer and the retriever call this function, so the two sides stay equal.
 */
export const bm25Options = (env: Bm25Env = {}): Bm25Options => {
	const options: Bm25Options = {}

	if (env.BM25_LANGUAGE !== undefined && env.BM25_LANGUAGE !== "") {
		options.language = env.BM25_LANGUAGE
	}

	if (env.BM25_ASCII_FOLDING !== undefined && env.BM25_ASCII_FOLDING !== "") {
		options.ascii_folding = env.BM25_ASCII_FOLDING === "true"
	}

	if (env.BM25_AVG_LEN !== undefined && env.BM25_AVG_LEN !== "") {
		const avgLen = Number(env.BM25_AVG_LEN)

		if (Number.isFinite(avgLen)) {
			options.avg_len = avgLen
		}
	}

	return options
}
