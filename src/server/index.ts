import { datasetConfigurations } from "../config/datasets";
import index from "../index.html";
import { bm25Options } from "../lib/bm25";
import { createEmbedder } from "../lib/embedder";
import { createIndexStateStore, DEFAULT_INDEX_STATE_PATH } from "../lib/index-state";
import { createQdrantClient } from "../lib/qdrant";
import { createWeightedRetriever } from "../lib/retrieval";
import { createRetriever } from "../lib/slogan-retrieval";
import { buildSyntaxIndexConfiguration, createSyntaxParser } from "../lib/syntax/config";
import { encodeTree } from "../lib/syntax/encoder";
import { createSlogansHandler } from "./api";
import { createChatHandler } from "./chat";

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

// The legacy fused retriever stays for the chat tool until T0010 migrates the callers.
const retriever = createRetriever({ embedder, client, bm25, fields });

// The weighted retriever serves `GET /api/slogans` and scores the syntax index.
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

/** Identity that the OpenCode Go gateway expects on every chat request. */
const identity = {
	userAgent: "hybrid-rag-retrieval/1.0",
	sessionId: crypto.randomUUID()
};
const chat = createChatHandler({ retriever, env: process.env, identity });

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
