import { datasetConfigurations } from "../src/config/datasets"
import { type Bm25Options, bm25Options } from "../src/lib/bm25"
import { createEmbedder, type Embedder } from "../src/lib/embedder"
import { createQdrantClient, type Point, type QdrantClient } from "../src/lib/qdrant"
import type { Slogan } from "../src/models/slogan"
import { streamDataset } from "../src/utils/data-utils"

/** Maximum points per upsert request (well under Qdrant's 32 MB REST limit). */
const BATCH_SIZE = 256

/** Clients that the indexer needs. Tests inject fakes. */
export type IndexerDependencies = {
	/** Qdrant collection operations. */
	client: Pick<QdrantClient, "deleteCollection" | "ensureCollection" | "upsert">
	/** Dense embedder for the content field. */
	embedder: Pick<Embedder, "embedDenseDocuments">
	/** BM25 options, shared with query time. */
	bm25: Bm25Options
	/** Sink for progress and rejection messages. */
	log?: (message: string) => void
}

/** Runtime options for one indexing run. */
export type IndexOptions = {
	/** Corpus file. Defaults to the slogan dataset path. */
	filePath?: string
	/** Stop after this many indexed records. */
	limit?: number
}

/** Result of one indexing run. */
export type IndexSummary = {
	/** Valid records read from the corpus. */
	accepted: number
	/** Rejected blocks read from the corpus. */
	rejected: number
	/** Points written to Qdrant. */
	indexed: number
}

/**
 * Read the slogan corpus through the T0002 stream reader and index each valid
 * record into Qdrant.
 *
 * The run drops and recreates the collection first, so a rerun is safe. Each
 * point holds the client-side dense vector and the Qdrant BM25 inference input.
 * A rejected block never stops the run. The function logs each rejected block
 * with the corpus path, the block number, and the reason.
 */
export const indexSlogans = async (
	dependencies: IndexerDependencies,
	options: IndexOptions = {},
): Promise<IndexSummary> => {
	const config = datasetConfigurations.slogans
	const filePath = options.filePath ?? config.filePath
	const limit = options.limit ?? Number.POSITIVE_INFINITY
	const log = dependencies.log ?? (() => {})
	const contentField = config.contentField
	let batch: Array<{ id: number; record: Slogan }> = []
	let accepted = 0
	let rejected = 0
	let indexed = 0

	/** Embed and upsert the pending records, bounded by the run limit. */
	const flush = async (): Promise<void> => {
		if (batch.length === 0) {
			return
		}

		const pending = batch.slice(0, Math.max(limit - indexed, 0))
		batch = []

		if (pending.length === 0) {
			return
		}

		const texts = pending.map(({ record }) => record[contentField])
		const dense = await dependencies.embedder.embedDenseDocuments(texts)
		const points: Point[] = pending.map(({ id, record }, index) => ({
			id,
			vector: {
				dense: dense[index] ?? [],
				bm25: { text: record[contentField], model: "qdrant/bm25", options: dependencies.bm25 },
			},
			payload: { ...record },
		}))

		await dependencies.client.upsert(points)
		indexed += points.length
		log(`Indexed ${indexed} records`)
	}

	await dependencies.client.deleteCollection()
	await dependencies.client.ensureCollection()
	log(`Indexing ${filePath}`)

	for await (const event of streamDataset<Slogan>(filePath, config).events) {
		if (event.type === "rejected") {
			rejected += 1
			log(`Rejected block ${event.block} in ${filePath}: ${event.reason}`)
			continue
		}

		accepted += 1
		batch.push({ id: event.record[config.identifierField], record: event.record })

		if (indexed + batch.length >= limit) {
			await flush()
			break
		}

		if (batch.length >= BATCH_SIZE) {
			await flush()
		}
	}

	await flush()
	log(`Done: ${indexed} indexed, ${accepted} read, ${rejected} rejected`)

	return { accepted, rejected, indexed }
}

/** Parse the optional `--limit N` command-line flag. */
const parseLimit = (argv: readonly string[]): number | undefined => {
	const index = argv.indexOf("--limit")

	if (index === -1) {
		return undefined
	}

	const raw = argv[index + 1]

	if (raw === undefined) {
		throw new Error("--limit requires a number.")
	}

	const limit = Number(raw)

	if (!Number.isSafeInteger(limit) || limit <= 0) {
		throw new Error(`Invalid --limit value "${raw}".`)
	}

	return limit
}

if (import.meta.main) {
	const logger = (message: string) => console.log(`[index-slogans] ${message}`)

	try {
		const limit = parseLimit(process.argv.slice(2))
		const client = createQdrantClient(process.env)
		const embedder = await createEmbedder(process.env)
		const summary = await indexSlogans(
			{ client, embedder, bm25: bm25Options(process.env), log: logger },
			{ limit },
		)

		logger(`Finished: ${JSON.stringify(summary)}`)
	} catch (error) {
		console.error(
			`[index-slogans] failed: ${error instanceof Error ? error.message : String(error)}`,
		)
		process.exit(1)
	}
}
