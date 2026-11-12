/**
 * Capture and compare a baseline of one Qdrant collection.
 *
 * The baseline records the point count, the three example queries, the exact dense and sparse
 * scores, and the hybrid identifier order. An upgrade is allowed only when the comparison finds no
 * blocker. The script never writes to the collection.
 *
 * Usage:
 *
 * - `bun run scripts/qdrant-baseline.ts capture --collection slogans --out <file>`
 * - `bun run scripts/qdrant-baseline.ts compare --before <file> --after <file>`
 */

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { datasetConfigurations } from "../src/config/datasets";
import { bm25Options } from "../src/lib/bm25";
import { createEmbedder } from "../src/lib/embedder";
import { type BaselineSnapshot, compareBaselines } from "../src/lib/qdrant-baseline";
import { createQdrantClient, type IndexScore } from "../src/lib/qdrant";

/** The example queries of `scripts/smoke-retrieval.ts`, in capture order. */
const QUERIES = [
	"slogans sur les produits laitiers de 2005",
	"slogans similaires à 'Un peu de sucre, beaucoup d'idées'",
	"slogans sur le sucre"
];

/** Fused results per query, as in the smoke script. */
const HYBRID_LIMIT = 5;

/** Candidates per prefetch, as the legacy retriever builds them. */
const PREFETCH_FACTOR = 4;

/** Error that maps to exit code 2: bad usage or an unreadable input. */
class InputError extends Error {
	/** Create the error with a message for the user. */
	constructor(message: string) {
		super(message);
		this.name = "InputError";
	}
}

/** Read one repeated-free flag value, or raise an input error when it is absent. */
const flagValue = (flags: Map<string, string>, name: string): string => {
	const value = flags.get(name);

	if (value === undefined || value === "") {
		throw new InputError(`missing required flag --${name}`);
	}

	return value;
};

/** Parse `--name value` pairs from the arguments after the subcommand. */
const parseFlags = (args: string[]): Map<string, string> => {
	const flags = new Map<string, string>();

	for (let index = 0; index < args.length; index += 1) {
		const token = args[index];

		if (!token.startsWith("--")) {
			throw new InputError(`unexpected argument "${token}"`);
		}

		const name = token.slice(2);
		const value = args[index + 1];

		if (value === undefined || value.startsWith("--")) {
			throw new InputError(`missing value for --${name}`);
		}

		flags.set(name, value);
		index += 1;
	}

	return flags;
};

/** Read a JSON file, or raise an input error that names the path. */
const readJson = async <T>(path: string): Promise<T> => {
	try {
		return JSON.parse(await Bun.file(path).text()) as T;
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);

		throw new InputError(`cannot read ${path}: ${reason}`);
	}
};

/** Find the dataset configuration that owns a collection. */
const resolveDataset = (collection: string) => {
	for (const configuration of Object.values(datasetConfigurations)) {
		if (configuration.collectionSchema.collection === collection) {
			return configuration;
		}
	}

	const known = Object.values(datasetConfigurations)
		.map((configuration) => configuration.collectionSchema.collection)
		.join(", ");

	throw new InputError(`unknown collection "${collection}"; configured collections: ${known}`);
};

/** Read the server version from `GET /`. */
const readVersion = async (url: string): Promise<string> => {
	const response = await fetch(`${url}/`);

	if (!response.ok) {
		throw new InputError(`GET ${url}/ failed (${response.status})`);
	}

	const body = (await response.json()) as { version?: unknown };

	if (typeof body.version !== "string") {
		throw new InputError(`GET ${url}/ returned no version`);
	}

	return body.version;
};

/** Read the point count from the collection info endpoint. */
const readPointsCount = async (url: string, collection: string): Promise<number> => {
	const path = `${url}/collections/${encodeURIComponent(collection)}`;
	const response = await fetch(path);

	if (!response.ok) {
		throw new InputError(`GET ${path} failed (${response.status})`);
	}

	const body = (await response.json()) as { result?: { points_count?: unknown } };
	const count = body.result?.points_count;

	if (typeof count !== "number") {
		throw new InputError(`GET ${path} returned no points_count`);
	}

	return count;
};

/** Capture one snapshot of a live collection. */
const capture = async (flags: Map<string, string>): Promise<void> => {
	const collection = flagValue(flags, "collection");
	const out = flagValue(flags, "out");
	const configuration = resolveDataset(collection);
	const env = process.env;
	const client = createQdrantClient(configuration.collectionSchema, env);
	const embedder = await createEmbedder(env);
	const bm25 = bm25Options(env);
	const version = await readVersion(client.url);
	const pointsCount = await readPointsCount(client.url, collection);
	const ids = await client.scrollIds();
	const dense: IndexScore[][] = [];
	const sparse: IndexScore[][] = [];
	const hybrid: Array<Array<number | string>> = [];

	for (const query of QUERIES) {
		const vector = await embedder.embedDenseQuery(query);
		const exactDense = await client.queryDenseExact({ vector, ids, onMissing: "skip" });
		const exactSparse = await client.querySparseExact({ text: query, bm25Options: bm25, ids });
		const fused = await client.queryHybrid({
			dense: vector,
			text: query,
			bm25Options: bm25,
			limit: HYBRID_LIMIT,
			prefetchLimit: HYBRID_LIMIT * PREFETCH_FACTOR
		});

		dense.push(exactDense.scores);
		sparse.push(exactSparse.scores);
		hybrid.push(fused.map((hit) => hit.id));
	}

	const snapshot: BaselineSnapshot = {
		version,
		collection,
		capturedAt: new Date().toISOString(),
		pointsCount,
		queries: QUERIES,
		dense,
		sparse,
		hybrid
	};

	mkdirSync(dirname(out), { recursive: true });
	await Bun.write(out, `${JSON.stringify(snapshot, null, 2)}\n`);
	console.log(`Captured ${collection} on Qdrant ${version} to ${out}`);
};

/** Compare two saved snapshots and print the diff. */
const compare = async (flags: Map<string, string>): Promise<void> => {
	const beforePath = flagValue(flags, "before");
	const afterPath = flagValue(flags, "after");
	const before = await readJson<BaselineSnapshot>(beforePath);
	const after = await readJson<BaselineSnapshot>(afterPath);
	const diff = compareBaselines(before, after);

	console.log(JSON.stringify(diff, null, 2));

	if (diff.blockers.length > 0) {
		process.exitCode = 1;
	}
};

/** Run the command named by the first argument. */
const main = async (): Promise<void> => {
	const [command, ...rest] = process.argv.slice(2);

	try {
		if (command === "capture") {
			await capture(parseFlags(rest));
		} else if (command === "compare") {
			await compare(parseFlags(rest));
		} else {
			throw new InputError(
				"usage: qdrant-baseline.ts <capture|compare> " +
					"capture --collection <name> --out <file> | compare --before <file> --after <file>"
			);
		}
	} catch (error) {
		if (error instanceof InputError) {
			console.error(`ERROR: ${error.message}`);
			process.exitCode = 2;

			return;
		}

		console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	}
};

if (import.meta.main) {
	await main();
}
