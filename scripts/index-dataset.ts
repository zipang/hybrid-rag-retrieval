/**
 * Resumable dense import of one configured dataset into Qdrant.
 *
 * One command imports either configured corpus. The run is non-destructive by default: it creates
 * the collection when absent, reads the identifiers that the collection already holds, and skips
 * every record whose identifier is present. `--drop` is the only way to delete a collection.
 *
 * A run publishes a ready generation only when the corpus stream ends by itself. A run stopped by
 * `--limit` is truncated, so it publishes nothing and leaves the generation `rebuilding`. A run
 * that reaches the limit on the last record of the corpus still publishes, because it reads one
 * record past the limit to prove whether work remains.
 */

import { resolve } from "node:path";
import {
	type DatasetConfiguration,
	type DatasetName,
	datasetConfigurations
} from "../src/config/datasets";
import { type Bm25Env, type Bm25Options, bm25Options } from "../src/lib/bm25";
import { createEmbedder, type Embedder, type EmbedderEnv } from "../src/lib/embedder";
import { datasetStatePath, denseIndexConfigId, denseIndexIdentity } from "../src/lib/index-config";
import { createIndexStateStore, type IndexStateStore } from "../src/lib/index-state";
import {
	createQdrantClient,
	type Point,
	type QdrantClient,
	type QdrantEnv
} from "../src/lib/qdrant";
import type { Citation } from "../src/models/citation";
import type { Slogan } from "../src/models/slogan";
import { streamDataset } from "../src/utils/data-utils";

/** Maximum points per upsert request (well under Qdrant's 32 MB REST limit). */
const BATCH_SIZE = 256;

/** One dataset bound to its reader, its fields, and its collection. */
export type DatasetImportSession<T extends object> = {
	/** Dataset name from the configuration. */
	name: DatasetName;
	/** Configuration entry for this dataset. */
	configuration: DatasetConfiguration<T>;
	/** Read the content field of one record. */
	readContent: (record: T) => string;
	/** Read the identifier field of one record. */
	readIdentifier: (record: T) => number | string;
};

/** Clients that the indexer needs. Tests inject fakes. */
export type IndexerDependencies = {
	/** Qdrant collection operations. */
	client: Pick<QdrantClient, "deleteCollection" | "ensureCollection" | "scrollIds" | "upsert">;
	/** Dense embedder for the content field. */
	embedder: Pick<Embedder, "embedDenseDocuments" | "dims">;
	/** BM25 options, shared with query time. */
	bm25: Bm25Options;
	/** Durable index generation state. */
	state: Pick<IndexStateStore, "read" | "beginRebuild" | "publish">;
	/** Sink for progress and rejection messages. */
	log?: (message: string) => void;
	/** Fingerprint of the run configuration. */
	configId: string;
};

/** Runtime options for one indexing run. */
export type IndexOptions = {
	/** Corpus file. Defaults to the dataset configuration path. */
	filePath?: string;
	/** Maximum number of new records to index in this run. */
	limit?: number;
	/** Delete the collection before the run. Defaults to `false`. */
	drop?: boolean;
	/** Records per embedding and upsert batch. Defaults to 256. */
	batchSize?: number;
};

/** Result of one indexing run. */
export type IndexSummary = {
	/** Dataset that the run imported. */
	dataset: DatasetName;
	/** Valid records read from the corpus, including skipped ones. */
	accepted: number;
	/** Rejected blocks read from the corpus. */
	rejected: number;
	/** Valid records that the collection already held. */
	skipped: number;
	/** Points written in this run. */
	indexed: number;
	/** Points in the collection after the run: `existing + indexed`. */
	total: number;
	/** Whether the run published a ready state. */
	published: boolean;
};

/** Error raised when the run fingerprint differs from the persisted one. */
export class IndexConfigurationMismatchError extends Error {
	/** Dataset that the state file describes. */
	readonly dataset: DatasetName;
	/** Fingerprint already persisted for the generation. */
	readonly persisted: string;
	/** Fingerprint that this run would write. */
	readonly requested: string;

	/** Create the error with both fingerprints. */
	constructor(dataset: DatasetName, persisted: string, requested: string) {
		super(
			`dataset ${dataset} was indexed with configuration ${persisted}, but this run builds ` +
				`${requested}; run with --drop to rebuild the collection`
		);
		this.name = "IndexConfigurationMismatchError";
		this.dataset = dataset;
		this.persisted = persisted;
		this.requested = requested;
	}
}

/** Error raised when the embedder width differs from the dataset schema. */
export class DenseDimensionMismatchError extends Error {
	/** Dimensions that the embedder reports. */
	readonly embedder: number;
	/** Dimensions that the dataset configuration expects. */
	readonly configured: number;
	/** Dimensions that the collection schema declares. */
	readonly collection: number;

	/** Create the error with the three values. */
	constructor(embedder: number, configured: number, collection: number) {
		super(
			`the dense embedder returns ${embedder} dimensions, but the dataset configuration ` +
				`expects ${configured} and the collection schema declares ${collection}`
		);
		this.name = "DenseDimensionMismatchError";
		this.embedder = embedder;
		this.configured = configured;
		this.collection = collection;
	}
}

/** Error raised when the embedder returns fewer vectors than the batch holds. */
export class IncompleteEmbeddingError extends Error {
	/** Vectors that the embedder returned. */
	readonly received: number;
	/** Records in the batch. */
	readonly expected: number;

	/** Create the error with both counts. */
	constructor(received: number, expected: number) {
		super(
			`the dense embedder returned ${received} vector(s) for ${expected} record(s); ` +
				"refusing to write a point with an empty dense vector"
		);
		this.name = "IncompleteEmbeddingError";
		this.received = received;
		this.expected = expected;
	}
}

/** Error raised when a dataset name is not configured. */
export class UnknownDatasetError extends Error {
	/** Name that the caller supplied. */
	readonly requested: string;

	/** Create the error with the requested name and the valid names. */
	constructor(requested: string) {
		super(
			`unknown dataset "${requested}"; valid names: ${Object.keys(datasetConfigurations).join(", ")}`
		);
		this.name = "UnknownDatasetError";
		this.requested = requested;
	}
}

/** Return the message of an unknown error. */
const describeError = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

/** Return whether a value names a configured dataset. Private: the CLI is the only caller. */
const isDatasetName = (value: string): value is DatasetName =>
	Object.hasOwn(datasetConfigurations, value);

/**
 * Resolve a dataset name, defaulting to `slogans`.
 *
 * @param value Name from the command line, or `undefined` for the default.
 * @returns The resolved dataset name.
 * @throws {UnknownDatasetError} When the name is not configured.
 */
export const resolveDatasetName = (value: string | undefined): DatasetName => {
	const name = value ?? "slogans";

	if (!isDatasetName(name)) {
		throw new UnknownDatasetError(name);
	}

	return name;
};

/** Bind the slogan dataset to its two typed field readers. */
export const createSloganSession = (): DatasetImportSession<Slogan> => {
	const configuration = datasetConfigurations.slogans;

	return {
		name: "slogans",
		configuration,
		readContent: (record) => record[configuration.contentField],
		readIdentifier: (record) => record[configuration.identifierField]
	};
};

/** Bind the citation dataset to its two typed field readers. */
export const createCitationSession = (): DatasetImportSession<Citation> => {
	const configuration = datasetConfigurations.citations;

	return {
		name: "citations",
		configuration,
		readContent: (record) => record[configuration.contentField],
		readIdentifier: (record) => record[configuration.identifierField]
	};
};

/**
 * Convert a record identifier to a Qdrant point identifier.
 *
 * Both configured datasets declare an integer identifier. A string identifier is accepted only when
 * it names a safe integer, so a malformed record fails loudly instead of writing a point that no
 * scroll can match.
 *
 * @param id Identifier read from one record.
 * @returns The identifier as an integer point id.
 * @throws {Error} When the identifier does not name a safe integer.
 */
const pointIdOf = (id: number | string): number => {
	const value = typeof id === "number" ? id : Number(id);

	if (!Number.isSafeInteger(value)) {
		throw new Error(`record identifier "${String(id)}" is not an integer point id`);
	}

	return value;
};

/**
 * Normalize one identifier that a scroll returned.
 *
 * `scrollIds` reports `Array<number | string>`. Both configured datasets declare integer
 * identifiers, so a string form would miss a numeric lookup and re-embed the whole corpus, which is
 * the cost this importer exists to avoid. A string that names a safe integer becomes that number;
 * any other value stays as it is.
 *
 * @param id Identifier from the collection.
 * @returns The same identifier as a number when it names a safe integer.
 */
const normalizeIdentifier = (id: number | string): number | string => {
	if (typeof id === "number") {
		return id;
	}

	const trimmed = id.trim();

	if (trimmed === "") {
		return id;
	}

	const value = Number(trimmed);

	return Number.isSafeInteger(value) ? value : id;
};

/**
 * Copy one validated record into an opaque payload object.
 *
 * The record type is generic, so a spread typed as `T` cannot satisfy `Record<string, unknown>`
 * directly. Copying the entries keeps the payload exact and needs no cast.
 */
const payloadOf = <T extends object>(record: T): Record<string, unknown> => {
	const payload: Record<string, unknown> = {};

	for (const [key, value] of Object.entries(record)) {
		payload[key] = value;
	}

	return payload;
};

/** One pending record of the current batch. */
type BatchEntry<T extends object> = {
	/** Point identifier. */
	id: number;
	/** Validated record. */
	record: T;
	/** Content text, read once. */
	text: string;
};

/**
 * Import one dataset into its collection.
 *
 * The run validates the embedder width, compares the configuration fingerprint, begins a new
 * generation, creates the collection when absent, and skips the identifiers that the collection
 * already holds. It publishes a ready state only when the corpus stream ends by itself.
 *
 * @param session Dataset bound to its configuration and its field readers.
 * @param dependencies Client, embedder, BM25 options, state store, log, and fingerprint.
 * @param options Corpus path, limit, drop flag, and batch size.
 * @returns The counts of the run.
 * @throws {DenseDimensionMismatchError} When the embedder width differs from the schema; nothing is
 *   written and no collection is created.
 * @throws {IndexConfigurationMismatchError} When the fingerprint differs and `drop` is false;
 *   nothing is written and nothing is published.
 */
export const indexDataset = async <T extends object>(
	session: DatasetImportSession<T>,
	dependencies: IndexerDependencies,
	options: IndexOptions = {}
): Promise<IndexSummary> => {
	const configuration = session.configuration;
	const filePath = options.filePath ?? configuration.filePath;
	const limit = options.limit ?? Number.POSITIVE_INFINITY;
	const batchSize = options.batchSize ?? BATCH_SIZE;
	const drop = options.drop ?? false;
	const log = dependencies.log ?? (() => {});
	const denseSize = configuration.collectionSchema.dense.size;

	if (
		dependencies.embedder.dims !== configuration.embeddingSize ||
		denseSize !== configuration.embeddingSize
	) {
		throw new DenseDimensionMismatchError(
			dependencies.embedder.dims,
			configuration.embeddingSize,
			denseSize
		);
	}

	const state = await dependencies.state.read();
	const persisted = state.current?.configId;

	if (!drop && persisted !== undefined && persisted !== dependencies.configId) {
		throw new IndexConfigurationMismatchError(session.name, persisted, dependencies.configId);
	}

	const startedAt = performance.now();
	// The writer token is deliberately omitted. A truncated chunk leaves the generation
	// `rebuilding`, and the next sequential chunk must be able to take it over; passing the
	// persisted token would raise `ConcurrentWriteError` on the very next run. A second concurrent
	// writer is still caught, because `publish` checks the writer that `beginRebuild` returned.
	const begun = await dependencies.state.beginRebuild({ configId: dependencies.configId });

	log(`Rebuild generation ${begun.generation} for ${filePath}`);

	if (drop) {
		await dependencies.client.deleteCollection();
	}

	await dependencies.client.ensureCollection();

	const existingIds = drop ? [] : await dependencies.client.scrollIds();
	const existing = new Set<number | string>(existingIds.map(normalizeIdentifier));
	let batch: BatchEntry<T>[] = [];
	let accepted = 0;
	let rejected = 0;
	let skipped = 0;
	let indexed = 0;
	let truncated = false;
	let limitReached = false;

	/** Embed and upsert the pending records. */
	const flush = async (): Promise<void> => {
		if (batch.length === 0) {
			return;
		}

		const pending = batch;
		batch = [];

		const texts = pending.map((entry) => entry.text);
		const dense = await dependencies.embedder.embedDenseDocuments(texts);

		if (dense.length !== pending.length) {
			throw new IncompleteEmbeddingError(dense.length, pending.length);
		}

		const points: Point[] = pending.map((entry, position) => ({
			id: entry.id,
			vector: {
				dense: dense[position],
				bm25: {
					text: entry.text,
					model: "qdrant/bm25",
					options: dependencies.bm25
				}
			},
			payload: payloadOf(entry.record)
		}));

		await dependencies.client.upsert(points);
		indexed += points.length;

		const elapsedSeconds = Math.round((performance.now() - startedAt) / 1000);
		const rate =
			elapsedSeconds === 0 ? "" : `, ${Math.round(indexed / elapsedSeconds)} records/s`;

		log(
			`Indexed ${indexed} (skipped ${skipped}, rejected ${rejected}) in ` +
				`${elapsedSeconds}s${rate}`
		);
	};

	for await (const event of streamDataset<T>(filePath, configuration).events) {
		if (event.type === "rejected") {
			rejected += 1;
			log(`Rejected block ${event.block} in ${filePath}: ${event.reason}`);
			continue;
		}

		accepted += 1;

		const id = pointIdOf(session.readIdentifier(event.record));

		// The set states what the collection holds after this run: the records read before it, plus
		// every record that this run queued. A corpus that repeats an identifier therefore counts
		// the repeat as skipped and never writes the point twice.
		if (existing.has(id)) {
			skipped += 1;
			continue;
		}

		if (limitReached) {
			// The limit is spent and this record is new, so the corpus still holds unindexed work.
			// Reading one record is enough to prove it; the record is never embedded or written.
			truncated = true;
			break;
		}

		existing.add(id);
		batch.push({ id, record: event.record, text: session.readContent(event.record) });

		if (batch.length >= batchSize) {
			await flush();
		}

		if (indexed + batch.length >= limit) {
			await flush();
			limitReached = true;
		}
	}

	await flush();

	// Every point that the collection holds now is in the set, so the size counts points, not
	// writes.
	const total = existing.size;
	let published = false;

	if (truncated) {
		log(
			`Warning: the run stopped after ${indexed} new record(s) because of --limit, so ` +
				`generation ${begun.generation} stays rebuilding`
		);
	} else {
		await dependencies.state.publish({
			writer: begun.writer,
			expectedGeneration: begun.generation,
			recordCount: total,
			configId: dependencies.configId
		});
		published = true;
	}

	log(`Done: ${indexed} indexed, ${skipped} skipped, ${accepted} read, ${rejected} rejected`);

	return { dataset: session.name, accepted, rejected, skipped, indexed, total, published };
};

/** Context of one command-line import. */
export type DatasetRunnerContext = {
	/** Environment for Qdrant, the embedder, and BM25. */
	env: EmbedderEnv & Bm25Env & QdrantEnv;
	/** Path of the durable generation state. */
	statePath: string;
	/** Runtime options of the import. */
	options: IndexOptions;
	/** Progress sink. */
	log?: (message: string) => void;
	/**
	 * Build the collection client from a dataset schema.
	 *
	 * Defaults to {@link createQdrantClient}. The seam lets a test observe which schema a dataset
	 * runner passes, so the claim that only the selected collection is named is provable.
	 */
	createClient?: typeof createQdrantClient;
};

/**
 * Build the dependencies of one dataset session and run the import.
 *
 * The client, the embedder, the state store, the BM25 options, and the fingerprint all derive from
 * the session configuration and the environment, so no dataset-specific value lives here.
 */
const runSession = async <T extends object>(
	session: DatasetImportSession<T>,
	context: DatasetRunnerContext
): Promise<IndexSummary> => {
	const buildClient = context.createClient ?? createQdrantClient;
	const client = buildClient(session.configuration.collectionSchema, context.env);
	const embedder = await createEmbedder(context.env);
	const state = createIndexStateStore(context.statePath);
	const configId = await denseIndexConfigId(
		denseIndexIdentity(session.name, context.env, embedder.dims)
	);

	return indexDataset(
		session,
		{
			client,
			embedder,
			bm25: bm25Options(context.env),
			state,
			log: context.log,
			configId
		},
		context.options
	);
};

/** Runner of one configured dataset. */
export type DatasetRunner = (context: DatasetRunnerContext) => Promise<IndexSummary>;

/** Runner per configured dataset. Each entry fixes its own record type. */
export const datasetRunners = {
	slogans: (context: DatasetRunnerContext) => runSession(createSloganSession(), context),
	citations: (context: DatasetRunnerContext) => runSession(createCitationSession(), context)
} satisfies Record<DatasetName, DatasetRunner>;

/** Usage text of the indexer. */
export const USAGE = [
	"Usage: bun run index [--dataset slogans|citations] [--drop] [--limit N] [--batch-size N]",
	"",
	"  --dataset <name>   Dataset to import. Defaults to slogans.",
	"  --drop             Delete the collection of that dataset before the run.",
	"  --limit <N>        Stop after N new records. A truncated run publishes nothing.",
	"  --batch-size <N>   Records per embedding and upsert batch. Defaults to 256.",
	"  --help             Print this usage and exit."
].join("\n");

/** Options resolved from the command line. */
export type CliOptions = {
	/** Dataset to import. */
	dataset: DatasetName;
	/** Delete the collection before the run. */
	drop: boolean;
	/** Maximum number of new records to index. */
	limit?: number;
	/** Records per batch. */
	batchSize?: number;
	/** Path of the durable generation state. */
	statePath: string;
};

/** Parse one positive integer flag. */
const positiveInteger = (raw: string, flag: string): number => {
	const value = Number(raw);

	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new Error(`Invalid ${flag} value "${raw}"; expected a positive integer.`);
	}

	return value;
};

/** Environment values that the command line reads. */
export type IndexCliEnv = {
	/** Overrides the dataset state file path. */
	INDEX_STATE_PATH?: string;
	/** Extra environment values, so `process.env` is assignable. */
	[key: string]: string | undefined;
};

/**
 * Error raised when `INDEX_STATE_PATH` names another dataset's state file.
 *
 * A run that publishes into the state file of another dataset marks the other generation ready with
 * counts measured elsewhere. Only a path that is distinct from every other dataset's default is
 * accepted.
 */
export class ForeignStatePathError extends Error {
	/** Dataset that the run imports. */
	readonly dataset: DatasetName;
	/** Dataset whose state file the path resolves to. */
	readonly owner: DatasetName;
	/** Path that the caller supplied. */
	readonly path: string;

	/** Create the error with both datasets and the path. */
	constructor(dataset: DatasetName, owner: DatasetName, path: string) {
		super(
			`INDEX_STATE_PATH ${path} is the state file of the ${owner} dataset, but this run ` +
				`imports ${dataset}; use a path of its own, for example .tmp/probe-state.json`
		);
		this.name = "ForeignStatePathError";
		this.dataset = dataset;
		this.owner = owner;
		this.path = path;
	}
}

/**
 * Resolve the state file path of one import.
 *
 * The dataset default is used when `INDEX_STATE_PATH` is absent or blank. When the variable is set,
 * it must not resolve to the state file of another dataset. A path outside the defaults, such as a
 * probe file under `.tmp/`, is accepted.
 *
 * @param dataset Dataset that the run imports.
 * @param override Value of `INDEX_STATE_PATH`.
 * @returns The state file path of the run.
 * @throws {ForeignStatePathError} When the override names another dataset's state file.
 */
export const resolveStatePath = (dataset: DatasetName, override: string | undefined): string => {
	if (override === undefined || override.trim() === "") {
		return datasetStatePath(dataset);
	}

	const resolved = resolve(override);

	for (const other of Object.keys(datasetConfigurations)) {
		if (!isDatasetName(other)) {
			continue;
		}

		if (other !== dataset && resolve(datasetStatePath(other)) === resolved) {
			throw new ForeignStatePathError(dataset, other, override);
		}
	}

	return override;
};

/**
 * Parse the command line into one import target.
 *
 * @param argv Arguments after the script name.
 * @param env Environment that may override the state file path.
 * @returns The resolved options, or `null` when `--help` was requested.
 * @throws {UnknownDatasetError} When `--dataset` names no configured dataset.
 * @throws {ForeignStatePathError} When the state override is another dataset's file.
 * @throws {Error} When a flag is unknown or a value is invalid.
 */
export const parseCliOptions = (
	argv: readonly string[],
	env: IndexCliEnv = {}
): CliOptions | null => {
	let dataset: string | undefined;
	let drop = false;
	let limit: number | undefined;
	let batchSize: number | undefined;

	for (let position = 0; position < argv.length; position += 1) {
		const flag = argv[position];

		if (flag === "--help") {
			return null;
		}

		if (flag === "--drop") {
			drop = true;
			continue;
		}

		if (flag === "--dataset" || flag === "--limit" || flag === "--batch-size") {
			const value = argv[position + 1];

			if (value === undefined) {
				throw new Error(`${flag} requires a value.`);
			}

			position += 1;

			if (flag === "--dataset") {
				dataset = value;
			} else if (flag === "--limit") {
				limit = positiveInteger(value, flag);
			} else {
				batchSize = positiveInteger(value, flag);
			}

			continue;
		}

		throw new Error(`Unknown argument "${flag}".\n\n${USAGE}`);
	}

	const name = resolveDatasetName(dataset);

	return {
		dataset: name,
		drop,
		limit,
		batchSize,
		statePath: resolveStatePath(name, env.INDEX_STATE_PATH)
	};
};

/** Run the command-line tool. */
const main = async (): Promise<void> => {
	const log = (message: string) => console.log(`[index-dataset] ${message}`);

	try {
		const options = parseCliOptions(process.argv.slice(2), process.env);

		if (options === null) {
			console.log(USAGE);

			return;
		}

		const summary = await datasetRunners[options.dataset]({
			env: process.env,
			statePath: options.statePath,
			options: { limit: options.limit, drop: options.drop, batchSize: options.batchSize },
			log
		});

		// One bare JSON line, so a caller can parse the run without stripping a log prefix.
		console.log(JSON.stringify(summary));
	} catch (error) {
		console.error(`[index-dataset] failed: ${describeError(error)}`);
		process.exit(1);
	}
};

if (import.meta.main) {
	await main();
}
