/**
 * Syntax-only backfill of the `ast` vector over records that already exist.
 *
 * The run never deletes the collection and never rewrites the dense vector, the BM25 vector, or the
 * business payload. It adds the `ast` vector definition when it is absent, encodes every eligible
 * record, and publishes a ready syntax state only after it accounts for every record.
 *
 * Coverage accounting is strict:
 *
 * - `eligible` is the size of the identifier set read from the collection;
 * - `indexed` counts the records whose matrix was written;
 * - `unsupported` counts the records that the parser cannot represent, with the error message as the
 *   reason, or `empty structure` when the encoder yields no usable row;
 * - `failed` counts the records that hit a temporary error, for example a failed vector update.
 *
 * One failed record never aborts the run. A parser that is unavailable aborts the run before any
 * publication, because a missing model would otherwise publish a partial coverage as ready.
 */

import { resolve } from "node:path";
import { datasetConfigurations } from "../src/config/datasets";
import {
	createIndexStateStore,
	DEFAULT_INDEX_STATE_PATH,
	type IndexStateStore,
	type SyntaxIndexConfiguration,
	type SyntaxIndexCoverage
} from "../src/lib/index-state";
import { createQdrantClient, type QdrantClient } from "../src/lib/qdrant";
import { InvalidSchemaError, type CollectionSchema } from "../src/lib/qdrant-schema";
import { AbstractionError, abstractTree, type SyntaxMode } from "../src/lib/syntax/abstraction";
import { buildSyntaxIndexConfiguration, createSyntaxParser } from "../src/lib/syntax/config";
import { DEFAULT_ENCODER_CONFIG, type EncodedVector, encodeTree } from "../src/lib/syntax/encoder";
import {
	EmptyInputError,
	type Parser,
	ParseValidationError,
	ParserUnavailableError
} from "../src/lib/syntax/parser";

/** Default number of identifiers per fetch and per vector update. */
const DEFAULT_BATCH_SIZE = 128;

/** Reason recorded when the encoder produces no usable row. */
const EMPTY_STRUCTURE_REASON = "empty structure";

/** Reason recorded when the payload has no usable content field. */
const MISSING_CONTENT_REASON = "missing content field";

/** Syntax modes that this build can index. The `detailed` mode is deferred. */
const AVAILABLE_MODES: readonly SyntaxMode[] = ["coarse"];

/** Error raised when a generation already holds another syntax mode. */
export class SyntaxModeClashError extends Error {
	/** Generation that holds the other mode. */
	readonly generation: string;
	/** Mode already persisted for the generation. */
	readonly indexed: SyntaxMode;
	/** Mode that the run requested. */
	readonly requested: SyntaxMode;

	/** Create the error with both modes. */
	constructor(generation: string, indexed: SyntaxMode, requested: SyntaxMode) {
		super(
			`generation ${generation} already holds the ${indexed} syntax mode; ` +
				`refusing to mix it with ${requested}`
		);
		this.name = "SyntaxModeClashError";
		this.generation = generation;
		this.indexed = indexed;
		this.requested = requested;
	}
}

/** Error raised when a syntax mode has no implementation in this build. */
export class SyntaxModeUnavailableError extends Error {
	/** Mode that the caller requested. */
	readonly mode: SyntaxMode;

	/** Create the error with the requested mode. */
	constructor(mode: SyntaxMode) {
		super(
			`the ${mode} syntax mode is deferred; available modes: ${AVAILABLE_MODES.join(", ")}`
		);
		this.name = "SyntaxModeUnavailableError";
		this.mode = mode;
	}
}

/** Error raised when there is no generation to backfill. */
export class MissingGenerationError extends Error {
	/** Create the error. */
	constructor() {
		super("no index generation is available; run the full indexer first");
		this.name = "MissingGenerationError";
	}
}

/** Error raised when the identifier batch size is not a positive integer. */
export class InvalidBatchSizeError extends Error {
	/** Value that the caller supplied. */
	readonly value: unknown;

	/** Create the error with the rejected value. */
	constructor(value: unknown) {
		super(`batch size must be a positive integer, got ${String(value)}`);
		this.name = "InvalidBatchSizeError";
		this.value = value;
	}
}

/**
 * Error raised when a run would publish another configuration into an existing syntax state.
 *
 * Stored vectors carry the configuration that produced them. A changed parser, model, abstraction,
 * or encoder means the stored vectors are no longer comparable, so the run must start a new
 * generation instead of overwriting vectors that a ready state still advertises.
 */
export class SyntaxConfigurationChangeError extends Error {
	/** Generation that holds the other configuration. */
	readonly generation: string;
	/** Fingerprint already persisted for the generation. */
	readonly indexed: string;
	/** Fingerprint that this run would publish. */
	readonly requested: string;

	/** Create the error with both fingerprints. */
	constructor(generation: string, indexed: string, requested: string) {
		super(
			`generation ${generation} was indexed with configuration ${indexed}, but this run ` +
				`builds ${requested}; a configuration change needs a new generation, not a backfill`
		);
		this.name = "SyntaxConfigurationChangeError";
		this.generation = generation;
		this.indexed = indexed;
		this.requested = requested;
	}
}

/**
 * Error raised when a run targets an isolated collection without an isolated state file.
 *
 * Vectors and generation state must describe the same collection. A run against another collection
 * that still writes the default state file would mark the real generation's syntax state ready with
 * coverage measured elsewhere.
 */
export class CustomCollectionStateError extends Error {
	/** Collection that the run targets. */
	readonly collection: string;
	/** Dataset collection that the state file describes. */
	readonly datasetCollection: string;

	/** Create the error with both collection names. */
	constructor(collection: string, datasetCollection: string) {
		super(
			`--collection ${collection} needs its own state file: set INDEX_STATE_PATH to a path ` +
				`other than the default, because the default state file describes the ` +
				`${datasetCollection} collection`
		);
		this.name = "CustomCollectionStateError";
		this.collection = collection;
		this.datasetCollection = datasetCollection;
	}
}

/** Transport operations and collaborators that the backfill needs. */
export type SyntaxBackfillDependencies = {
	/** Transport operations this run needs. */
	client: Pick<
		QdrantClient,
		"ensureAstVector" | "scrollIds" | "fetchPayloads" | "updateAstVectors" | "deleteVectors"
	>;
	/** Durable index generation state. */
	state: Pick<IndexStateStore, "read" | "assertReady" | "publishSyntax">;
	/** Syntax parser. */
	parser: Parser;
	/** Progress sink. */
	log?: (message: string) => void;
	/** Clock used for the published `updatedAt`. Defaults to the real clock. */
	now?: () => string;
	/**
	 * Encoder used to turn one abstract tree into vectors.
	 *
	 * Defaults to {@link encodeTree}. The seam exists because the real encoder cannot produce a zero
	 * row, so only an injected fake can prove the `empty structure` exclusion branch.
	 */
	encode?: typeof encodeTree;
};

/** Runtime options of one backfill run. */
export type SyntaxBackfillOptions = {
	/** Active syntax mode. Defaults to `coarse`. */
	mode?: SyntaxMode;
	/** Identifier batch size. Defaults to 128. */
	batchSize?: number;
	/** Generation to backfill. Defaults to the current generation. */
	generation?: string;
	/** Stop after this many identifiers. The coverage stays consistent with the truncation. */
	limit?: number;
};

/** Result of one backfill run. */
export type SyntaxBackfillSummary = {
	/** Coverage accounting of the run. */
	coverage: SyntaxIndexCoverage;
	/** Configuration that produced the stored vectors. */
	configuration: SyntaxIndexConfiguration;
	/** Identifiers whose `ast` vector the run asked Qdrant to delete. */
	cleared: number;
};

/** Return whether an encoded row has zero length, which the encoder forbids storing. */
const isZeroVector = (vector: EncodedVector): boolean => {
	let sum = 0;

	for (const value of vector.values) {
		sum += value * value;
	}

	return sum === 0;
};

/** Return the message of an unknown error. */
const describeError = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

/**
 * Backfill the `ast` vectors of the generation that the state store reports.
 *
 * The function resolves and validates the generation, resolves the configuration, refuses a mode
 * clash, declares the vector definition, and then indexes every eligible identifier. It publishes
 * exactly one syntax state after the loop.
 *
 * @param dependencies Transport, state, parser, log, clock, and optional encoder.
 * @param options Mode, batch size, generation, and limit.
 * @returns The published coverage and configuration, plus the count of cleared identifiers.
 * @throws {SyntaxModeUnavailableError} When the mode is not implemented in this build.
 * @throws {InvalidBatchSizeError} When the batch size is not a positive integer.
 * @throws {MissingGenerationError} When the state holds no generation.
 * @throws {SyntaxModeClashError} When the generation already holds another mode.
 * @throws {ParserUnavailableError} When the parser model is missing; nothing is published.
 */
export const indexSyntax = async (
	dependencies: SyntaxBackfillDependencies,
	options: SyntaxBackfillOptions = {}
): Promise<SyntaxBackfillSummary> => {
	const mode = options.mode ?? "coarse";
	const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
	const contentField = datasetConfigurations.slogans.contentField;
	const ast = datasetConfigurations.slogans.collectionSchema.ast;
	const log = dependencies.log ?? (() => {});
	const now = dependencies.now ?? (() => new Date().toISOString());
	const encode = dependencies.encode ?? encodeTree;

	if (ast === undefined) {
		throw new InvalidSchemaError(
			"ast",
			"is required by the syntax backfill but the slogan schema declares none"
		);
	}

	if (!AVAILABLE_MODES.includes(mode)) {
		throw new SyntaxModeUnavailableError(mode);
	}

	if (!Number.isSafeInteger(batchSize) || batchSize <= 0) {
		throw new InvalidBatchSizeError(batchSize);
	}

	const state = await dependencies.state.read();
	const generation = options.generation ?? state.current?.generation;

	if (generation === undefined) {
		throw new MissingGenerationError();
	}

	const record = await dependencies.state.assertReady(generation);
	const configuration = await buildSyntaxIndexConfiguration(mode);
	const stored = record.syntax?.configuration;

	if (stored !== undefined && stored.mode !== mode) {
		throw new SyntaxModeClashError(generation, stored.mode, mode);
	}

	if (stored !== undefined && stored.configId !== configuration.configId) {
		throw new SyntaxConfigurationChangeError(
			generation,
			stored.configId,
			configuration.configId
		);
	}

	log(
		`Generation ${generation}: mode ${mode}, configuration ${configuration.configId}, ` +
			`encoder ${configuration.encoderVersion}`
	);

	const added = await dependencies.client.ensureAstVector();

	log(added ? "Added the ast vector definition" : "The ast vector definition already exists");

	const scrolled = await dependencies.client.scrollIds();
	const ids = options.limit === undefined ? scrolled : scrolled.slice(0, options.limit);
	const truncated = ids.length < scrolled.length;
	const eligible = ids.length;
	const excluded = new Map<number | string, { reason: string; kind: "unsupported" | "failed" }>();
	let indexed = 0;
	let cleared = 0;

	log(`Enumerated ${eligible} eligible record(s)`);

	if (truncated) {
		log(
			`Warning: --limit covered ${eligible} of ${scrolled.length} records, so this run ` +
				"publishes pending, not ready"
		);
	}

	/** Record one excluded identifier with its reason and its accounting bucket. */
	const exclude = (id: number | string, reason: string, kind: "unsupported" | "failed"): void => {
		excluded.set(id, { reason, kind });
		log(`Excluded ${id} (${kind}): ${reason}`);
	};

	/**
	 * Write one group of encoded records.
	 *
	 * A batch failure is retried one record at a time, so one bad record marks only itself failed
	 * and the rest of the run continues.
	 */
	const writeRecords = async (
		points: Array<{ id: number | string; rows: number[][] }>
	): Promise<void> => {
		if (points.length === 0) {
			return;
		}

		try {
			await dependencies.client.updateAstVectors(points);
			indexed += points.length;

			return;
		} catch (error) {
			log(`Batch update failed: ${describeError(error)}; retrying one record at a time`);
		}

		for (const point of points) {
			try {
				await dependencies.client.updateAstVectors([point]);
				indexed += 1;
			} catch (error) {
				exclude(point.id, describeError(error), "failed");
			}
		}
	};

	for (let offset = 0; offset < ids.length; offset += batchSize) {
		const batchIds = ids.slice(offset, offset + batchSize);
		const payloads = await dependencies.client.fetchPayloads(batchIds);
		const writes: Array<{ id: number | string; rows: number[][] }> = [];

		for (const id of batchIds) {
			const text = payloads.get(id)?.[contentField];

			if (typeof text !== "string") {
				exclude(id, MISSING_CONTENT_REASON, "unsupported");
				continue;
			}

			let rows: number[][];

			try {
				const parsed = await dependencies.parser.parse(text);
				const tree = abstractTree(parsed, mode);
				const vectors = encode(tree, DEFAULT_ENCODER_CONFIG);

				if (vectors.length === 0 || vectors.some((vector) => isZeroVector(vector))) {
					exclude(id, EMPTY_STRUCTURE_REASON, "unsupported");
					continue;
				}

				rows = vectors.map((vector) => vector.values);
			} catch (error) {
				if (error instanceof ParserUnavailableError) {
					throw error;
				}

				if (
					error instanceof EmptyInputError ||
					error instanceof ParseValidationError ||
					error instanceof AbstractionError
				) {
					exclude(id, describeError(error), "unsupported");
				} else {
					exclude(id, describeError(error), "failed");
				}

				continue;
			}

			writes.push({ id, rows });
		}

		await writeRecords(writes);
	}

	/**
	 * Clear the `ast` vector of every excluded record.
	 *
	 * The clear uses the documented Qdrant "Delete Vectors" operation, which keeps the dense
	 * vector, the BM25 vector, and the payload of the point. A batch whose clear fails marks its
	 * records `failed`, so a record that kept a stale vector never passes as supported.
	 */
	const excludedIds = [...excluded.keys()];

	for (let offset = 0; offset < excludedIds.length; offset += batchSize) {
		const clearIds = excludedIds.slice(offset, offset + batchSize);

		try {
			await dependencies.client.deleteVectors(clearIds, [ast.name], { log });
			cleared += clearIds.length;
		} catch (error) {
			const reason = `clear failed: ${describeError(error)}`;

			log(`Clear failed for ${clearIds.join(", ")}: ${reason}`);

			for (const id of clearIds) {
				const previous = excluded.get(id);

				excluded.set(id, { reason, kind: "failed" });
				log(`Excluded ${id} (failed): ${reason} (was ${previous?.kind ?? "unsupported"})`);
			}
		}
	}

	const exclusions = [...excluded.entries()].map(([id, entry]) => ({ id, reason: entry.reason }));
	const unsupported = [...excluded.values()].filter(
		(entry) => entry.kind === "unsupported"
	).length;
	const failed = [...excluded.values()].filter((entry) => entry.kind === "failed").length;
	const coverage: SyntaxIndexCoverage = { eligible, indexed, unsupported, failed };

	/**
	 * A truncated run covers only a slice, so it must not advertise complete syntax coverage.
	 *
	 * `pending` keeps syntax reads blocked until a full run accounts for every record.
	 */
	const status = truncated ? "pending" : "ready";

	await dependencies.state.publishSyntax({
		writer: record.writer,
		expectedGeneration: record.generation,
		syntax: {
			configuration,
			status,
			coverage,
			updatedAt: now(),
			exclusions
		}
	});

	log(
		`Published ${generation} as ${status}: eligible ${eligible}, indexed ${indexed}, ` +
			`unsupported ${unsupported}, failed ${failed}, cleared ${cleared}`
	);

	return { coverage, configuration, cleared };
};

/** Return the value of one `--flag value` pair, or `undefined` when the flag is absent. */
const flagValue = (argv: readonly string[], flag: string): string | undefined => {
	const index = argv.indexOf(flag);

	if (index === -1) {
		return undefined;
	}

	const value = argv[index + 1];

	if (value === undefined) {
		throw new Error(`${flag} requires a value.`);
	}

	return value;
};

/** Parse one positive integer flag. */
const positiveInteger = (raw: string | undefined, flag: string): number | undefined => {
	if (raw === undefined) {
		return undefined;
	}

	const value = Number(raw);

	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new Error(`Invalid ${flag} value "${raw}".`);
	}

	return value;
};

/** Parse the `--mode` flag. Defaults to `coarse` and rejects every unknown value. */
const parseMode = (argv: readonly string[]): SyntaxMode => {
	const value = flagValue(argv, "--mode") ?? "coarse";

	if (value !== "coarse" && value !== "detailed") {
		throw new Error(`unknown mode "${value}"; expected "coarse" or "detailed".`);
	}

	return value;
};

/**
 * Return the slogan collection schema with another collection name.
 *
 * The `--collection` flag changes the collection only. The vector names, the payload fields, and
 * the payload indexes stay those of the dataset schema.
 *
 * @param collection Collection name to use.
 * @returns A copy of the slogan schema with the given collection name.
 */
export const schemaForCollection = (collection: string): CollectionSchema => ({
	...datasetConfigurations.slogans.collectionSchema,
	collection
});

/** Target of one command-line run: the collection schema and the state file it publishes into. */
export type CliTarget = {
	/** Schema to build the client with. */
	schema: CollectionSchema;
	/** Path of the durable generation state. */
	statePath: string;
};

/**
 * Resolve the collection schema and the state file of one command-line run.
 *
 * Vectors and generation state must describe the same collection. A run against another collection
 * therefore requires its own state file: without one, the run would publish coverage measured on
 * the probe collection into the state of the real generation. The refusal compares **resolved
 * paths**, so `data/index-state.json`, `./data/index-state.json`, and
 * `data/../data/index-state.json` all count as the default file.
 *
 * @param options `--collection` value and `INDEX_STATE_PATH` value, both optional.
 * @returns The schema to use and the state file path.
 * @throws {CustomCollectionStateError} When the collection is overridden without a distinct path.
 */
export const resolveCliTarget = (options: {
	collection?: string;
	statePath?: string;
}): CliTarget => {
	const datasetCollection = datasetConfigurations.slogans.collectionSchema.collection;
	const collection = options.collection ?? datasetCollection;
	const statePath = options.statePath;

	if (statePath === undefined || statePath.trim() === "") {
		if (collection !== datasetCollection) {
			throw new CustomCollectionStateError(collection, datasetCollection);
		}

		return {
			schema: datasetConfigurations.slogans.collectionSchema,
			statePath: DEFAULT_INDEX_STATE_PATH
		};
	}

	if (
		collection !== datasetCollection &&
		resolve(statePath) === resolve(DEFAULT_INDEX_STATE_PATH)
	) {
		throw new CustomCollectionStateError(collection, datasetCollection);
	}

	return {
		schema:
			collection === datasetCollection
				? datasetConfigurations.slogans.collectionSchema
				: schemaForCollection(collection),
		statePath
	};
};

/** Run the command-line tool. */
const main = async (): Promise<void> => {
	const argv = process.argv.slice(2);
	const mode = parseMode(argv);
	const batchSize = positiveInteger(flagValue(argv, "--batch-size"), "--batch-size");
	const limit = positiveInteger(flagValue(argv, "--limit"), "--limit");
	const generation = flagValue(argv, "--generation");
	const collection = flagValue(argv, "--collection");
	const log = (message: string) => console.log(`[index-syntax] ${message}`);
	const target = resolveCliTarget({
		collection,
		statePath: process.env.INDEX_STATE_PATH
	});
	const client = createQdrantClient(target.schema, process.env);
	const state = createIndexStateStore(target.statePath);
	const parser = createSyntaxParser(process.env);
	const summary = await indexSyntax(
		{ client, state, parser, log },
		{ mode, batchSize, generation, limit }
	);

	log(`Finished: ${JSON.stringify(summary)}`);
};

if (import.meta.main) {
	main().catch((error: unknown) => {
		console.error(
			`[index-syntax] failed: ${error instanceof Error ? error.message : String(error)}`
		);
		process.exit(1);
	});
}
