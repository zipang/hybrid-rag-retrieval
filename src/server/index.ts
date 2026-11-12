import { datasetConfigurations } from "../config/datasets";
import index from "../index.html";
import { bm25Options } from "../lib/bm25";
import { createEmbedder } from "../lib/embedder";
import { createIndexStateStore, DEFAULT_INDEX_STATE_PATH } from "../lib/index-state";
import { createQdrantClient } from "../lib/qdrant";
import { createWeightedRetriever } from "../lib/retrieval";
import { buildSyntaxIndexConfiguration, createSyntaxParser } from "../lib/syntax/config";
import { encodeTree } from "../lib/syntax/encoder";
import { createSearchSessionStore } from "./agent/session-store";
import { createAgentSessionCache, loadAgentResource } from "./agent/resource";
import { createSlogansHandler } from "./api";
import { DEFAULT_MIN_SCORE, DEFAULT_WEIGHTS, createChatHandler, createChatModel } from "./chat";

const port = Number(process.env.PORT ?? 3000);
const isDev = process.env.NODE_ENV !== "production";
const embedder = await createEmbedder(process.env);
const client = createQdrantClient(datasetConfigurations.slogans.collectionSchema, process.env);
const bm25 = bm25Options(process.env);
const fields = {
	year: "annee",
	brand: "marque",
	campaign: "campagne",
	content: "slogan"
};

// The weighted retriever serves `GET /api/slogans` and the agent's two tools.
const state = createIndexStateStore(DEFAULT_INDEX_STATE_PATH);
const syntaxConfiguration = await buildSyntaxIndexConfiguration("coarse");
const weighted = createWeightedRetriever({
	embedder,
	client,
	bm25,
	generation: (await state.read()).current?.generation,
	syntax: {
		parser: createSyntaxParser(process.env),
		encode: encodeTree,
		mode: "coarse",
		configId: syntaxConfiguration.configId
	},
	state
});
const slogans = createSlogansHandler({ retriever: weighted, fields });

/** Read `AGENT_MAX_STEPS` as an integer of at least one, or fall back to the default. */
const readMaxSteps = (raw: string | undefined): number | undefined => {
	if (raw === undefined || raw.trim() === "") {
		return undefined;
	}

	const value = Number(raw);

	return Number.isSafeInteger(value) && value >= 1 ? value : undefined;
};

/** Identity that the OpenAI-compatible gateway expects on every chat request. */
const identity = {
	userAgent: "hybrid-rag-retrieval/1.0",
	sessionId: crypto.randomUUID()
};
const sessions = createSearchSessionStore();
const agents = createAgentSessionCache(loadAgentResource);
const chat = createChatHandler({
	retriever: weighted,
	sessions,
	agents,
	defaultAgentId: process.env.AGENT_ID ?? "default",
	fields,
	weights: DEFAULT_WEIGHTS,
	minScore: DEFAULT_MIN_SCORE,
	env: process.env,
	identity,
	createModel: createChatModel,
	maxSteps: readMaxSteps(process.env.AGENT_MAX_STEPS)
});

const server = Bun.serve({
	port,
	routes: {
		"/": index,
		"/api/slogans": (request) => slogans(request),
		"/api/chat": (request) => chat(request)
	},
	development: {
		hmr: isDev,
		console: isDev
	}
});

console.log(`Listening on http://localhost:${server.port}`);
