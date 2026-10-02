import { datasetConfigurations } from "../src/config/datasets"
import { bm25Options } from "../src/lib/bm25"
import { createEmbedder } from "../src/lib/embedder"
import { createQdrantClient } from "../src/lib/qdrant"
import { createRetriever } from "../src/lib/slogan-retrieval"

/** The example queries from the T0001 spec. */
const QUERIES = [
	"slogans sur les produits laitiers de 2005",
	"slogans similaires à 'Un peu de sucre, beaucoup d'idées'",
	"slogans sur le sucre",
]

/** Number of results to print for each query. */
const TOP_K = 5

/**
 * Run the example queries against the indexed collection and print the ranked
 * results. Exit with a non-zero code when a query returns no result.
 */
const main = async (): Promise<void> => {
	const env = process.env
	const embedder = await createEmbedder(env)
	const client = createQdrantClient(datasetConfigurations.slogans.collectionSchema, env)
	const retriever = createRetriever({
		embedder,
		client,
		bm25: bm25Options(env),
		fields: { year: "annee", brand: "marque", campaign: "campagne", content: "slogan" },
	})
	let emptyCount = 0

	for (const query of QUERIES) {
		const hits = await retriever.retrieveHybrid(query, { topK: TOP_K })
		console.log(`\nQuery: ${query}`)
		console.log(`Results: ${hits.length}`)

		if (hits.length === 0) {
			emptyCount += 1
		}

		hits.forEach((hit, index) => {
			const score = hit.score.toFixed(4)

			console.log(`  ${index + 1}. [${score}] ${hit.annee} — ${hit.marque} — ${hit.slogan}`)
		})
	}

	if (emptyCount > 0) {
		console.error(`\n${emptyCount} query(ies) returned no result.`)
		process.exitCode = 1
	}
}

if (import.meta.main) {
	await main()
}
