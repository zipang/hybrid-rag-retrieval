import { datasetConfigurations } from "../config/datasets"
import index from "../index.html"
import { bm25Options } from "../lib/bm25"
import { createEmbedder } from "../lib/embedder"
import { createQdrantClient } from "../lib/qdrant"
import { createRetriever } from "../lib/slogan-retrieval"
import { createSlogansHandler } from "./api"
import { createChatHandler } from "./chat"

const port = Number(process.env.PORT ?? 3000)
const isDev = process.env.NODE_ENV !== "production"
const embedder = await createEmbedder(process.env)
const client = createQdrantClient(datasetConfigurations.slogans.collectionSchema, process.env)
const retriever = createRetriever({
	embedder,
	client,
	bm25: bm25Options(process.env),
	fields: { year: "annee", brand: "marque", campaign: "campagne", content: "slogan" },
})
const slogans = createSlogansHandler({ retriever })

/** Identity that the OpenCode Go gateway expects on every chat request. */
const identity = {
	userAgent: "hybrid-rag-retrieval/1.0",
	sessionId: crypto.randomUUID(),
}
const chat = createChatHandler({ retriever, env: process.env, identity })

const server = Bun.serve({
	port,
	routes: {
		"/": index,
		"/api/slogans": (request) => slogans(request),
		"/api/chat": (request) => chat(request),
	},
	development: {
		hmr: isDev,
		console: isDev,
	},
})

console.log(`Listening on http://localhost:${server.port}`)
