import type { EmbeddingModel as EmbeddingModelEnum } from "fastembed"

/** Dense models accepted by the standard fastembed init overload. */
type StandardEmbeddingModel = Exclude<EmbeddingModelEnum, EmbeddingModelEnum.CUSTOM>

/** Minimal dense model contract used by the embedder. */
export type DenseModel = {
	/** Embed documents for indexing. */
	passageEmbed: (texts: string[], batchSize?: number) => AsyncGenerator<number[][]>
	/** Embed a single query for retrieval. */
	queryEmbed: (query: string) => Promise<number[]>
}

/** Dense embedding operations used by indexing and retrieval. */
export type Embedder = {
	/** Dense vector size. */
	readonly dims: number
	/** Embed documents with the dense model. */
	embedDenseDocuments: (texts: string[]) => Promise<number[][]>
	/** Embed one query with the dense model. */
	embedDenseQuery: (text: string) => Promise<number[]>
}

/** Environment variables that configure the embedding provider. */
export type EmbedderEnv = {
	EMBEDDING_PROVIDER?: string
	EMBEDDING_MODEL?: string
	EMBEDDING_API_KEY?: string
}

/** Provider names that require a remote API key; no adapter ships in this POC. */
const CLOUD_PROVIDERS = new Set(["openai", "voyage", "cohere", "mistral"])

/** Default local dense model alias. */
const DEFAULT_DENSE_MODEL = "intfloat/multilingual-e5-large"

/** Combine a dense model behind the embedder interface. */
export const buildEmbedder = (dense: DenseModel, dims: number): Embedder => ({
	dims,
	embedDenseDocuments: async (texts) => (await Array.fromAsync(dense.passageEmbed(texts))).flat(),
	embedDenseQuery: (text) => dense.queryEmbed(text),
})

/** Create the local embedder from fastembed. The keyword side lives in Qdrant. */
const createLocalEmbedder = async (env: EmbedderEnv): Promise<Embedder> => {
	const { EmbeddingModel, FlagEmbedding } = await import("fastembed")

	const denseModels: Record<string, { model: StandardEmbeddingModel; dim: number }> = {
		"intfloat/multilingual-e5-large": { model: EmbeddingModel.MLE5Large, dim: 1024 },
		"multilingual-e5-large": { model: EmbeddingModel.MLE5Large, dim: 1024 },
		"BAAI/bge-small-en-v1.5": { model: EmbeddingModel.BGESmallENV15, dim: 384 },
		"bge-small-en-v1.5": { model: EmbeddingModel.BGESmallENV15, dim: 384 },
		"BAAI/bge-base-en-v1.5": { model: EmbeddingModel.BGEBaseENV15, dim: 768 },
		"bge-base-en-v1.5": { model: EmbeddingModel.BGEBaseENV15, dim: 768 },
		"sentence-transformers/all-MiniLM-L6-v2": { model: EmbeddingModel.AllMiniLML6V2, dim: 384 },
	}

	const alias = env.EMBEDDING_MODEL ?? DEFAULT_DENSE_MODEL
	const selection = denseModels[alias]

	if (selection === undefined) {
		throw new Error(
			`Unknown local embedding model "${alias}". Supported: ${Object.keys(denseModels).join(", ")}.`,
		)
	}

	const dense = await FlagEmbedding.init({ model: selection.model })

	return buildEmbedder(dense, selection.dim)
}

/** Factory for each supported embedding provider. */
const PROVIDERS: Record<string, (env: EmbedderEnv) => Promise<Embedder>> = {
	local: createLocalEmbedder,
}

/**
 * Resolve a dense embedder from environment variables.
 *
 * `EMBEDDING_PROVIDER` selects the factory and defaults to `local`. Cloud
 * providers are declared but not implemented in this POC; requesting one
 * either asks for the missing API key or reports the lack of an adapter.
 */
export const createEmbedder = async (env: EmbedderEnv): Promise<Embedder> => {
	const name = env.EMBEDDING_PROVIDER ?? "local"
	const factory = PROVIDERS[name]

	if (factory !== undefined) {
		return factory(env)
	}

	if (CLOUD_PROVIDERS.has(name)) {
		if (!env.EMBEDDING_API_KEY) {
			throw new Error(`Embedding provider "${name}" requires EMBEDDING_API_KEY.`)
		}

		throw new Error(
			`Embedding provider "${name}" has no adapter in this POC. Use "local" or add one.`,
		)
	}

	throw new Error(
		`Unknown embedding provider "${name}". Supported: ${Object.keys(PROVIDERS).join(", ")}.`,
	)
}
