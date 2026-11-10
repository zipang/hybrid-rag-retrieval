/**
 * Reproducible identity and state file path of one dense index run.
 *
 * A dense import runs in chunks. Every chunk must use the same dataset, collection, embedding
 * model, token width, vector dimensions, and BM25 options. Two chunks with different values write
 * vectors from different spaces into one collection, and Qdrant raises no error.
 * {@link denseIndexIdentity} collects the values and {@link denseIndexConfigId} turns them into a
 * short fingerprint that a run compares with the persisted one before any write.
 *
 * The module follows `syntaxConfigId` in `src/lib/syntax/config.ts` without importing that module,
 * which belongs to another ticket.
 *
 * The corpus content is deliberately not part of the fingerprint. The contract requires the same
 * corpus across the chunks of one import, and a file that changes mid-import is a caller error, not
 * a configuration change.
 */

import { type DatasetName, datasetConfigurations } from "../config/datasets";
import { type Bm25Env, type Bm25Options, bm25Options } from "./bm25";
import { DEFAULT_DENSE_MODEL, type EmbedderEnv, resolveMaxLength } from "./embedder";

/** Values that make two dense index chunks comparable. */
export type DenseIndexIdentity = {
	/** Dataset name. */
	dataset: DatasetName;
	/** Qdrant collection of the dataset. */
	collection: string;
	/** Embedding provider name, for example `local`. */
	provider: string;
	/** Dense model identifier. */
	model: string;
	/** Token width that the model pads every text to. */
	maxLength: number;
	/** Dense vector dimensions. */
	dimensions: number;
	/** BM25 options, shared with query time. */
	bm25: Bm25Options;
};

/**
 * Read the identity from the environment and the selected dataset.
 *
 * The provider defaults to `local`, the model defaults to {@link DEFAULT_DENSE_MODEL}, and the
 * token width defaults to the value of `resolveMaxLength`. The dimensions come from the embedder,
 * so the fingerprint describes the vectors that the run actually writes.
 *
 * @param dataset Dataset that the run imports.
 * @param env Environment that configures the embedder and BM25.
 * @param dimensions Dense vector size reported by the embedder.
 * @returns The identity of the run.
 */
export const denseIndexIdentity = (
	dataset: DatasetName,
	env: EmbedderEnv & Bm25Env,
	dimensions: number
): DenseIndexIdentity => ({
	dataset,
	collection: datasetConfigurations[dataset].collectionSchema.collection,
	provider: env.EMBEDDING_PROVIDER ?? "local",
	model: env.EMBEDDING_MODEL ?? DEFAULT_DENSE_MODEL,
	maxLength: resolveMaxLength(env),
	dimensions,
	bm25: bm25Options(env)
});

/**
 * Serialize a value as JSON with every object key sorted.
 *
 * Sorting at every level, not only at the top, makes two identities with the same values in a
 * different insertion order produce the same string. This includes the BM25 options object.
 *
 * @param value Value to serialize.
 * @returns Canonical JSON text.
 */
const canonicalJson = (value: unknown): string => {
	if (Array.isArray(value)) {
		return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
	}

	if (value !== null && typeof value === "object") {
		const entries = Object.entries(value).sort(([left], [right]) =>
			left < right ? -1 : left > right ? 1 : 0
		);
		const members = entries.map(
			([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`
		);

		return `{${members.join(",")}}`;
	}

	return JSON.stringify(value) ?? "null";
};

/**
 * Compute the stable fingerprint of an identity.
 *
 * The fingerprint is the first 16 hexadecimal characters of the SHA-256 digest of the canonical
 * JSON of every identity field. The same identity always gives the same value, and a change of one
 * field gives a different value.
 *
 * @param identity Identity of one dense index run.
 * @returns A 16-character hexadecimal fingerprint.
 */
export const denseIndexConfigId = async (identity: DenseIndexIdentity): Promise<string> => {
	const canonical = canonicalJson(identity);
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));

	return Buffer.from(digest).toString("hex").slice(0, 16);
};

/**
 * State file path for one dataset.
 *
 * The slogan dataset keeps `data/index-state.json`, because `scripts/index-syntax.ts` reads and
 * refuses that exact resolved path. Every other dataset gets its own file, so a citation run cannot
 * publish into the slogan generation.
 *
 * @param dataset Dataset that the state file describes.
 * @returns The state file path.
 */
export const datasetStatePath = (dataset: DatasetName): string =>
	dataset === "slogans" ? "data/index-state.json" : `data/index-state.${dataset}.json`;
