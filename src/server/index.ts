import { join, normalize, sep } from "node:path"
import { bm25Options } from "../lib/bm25"
import { createEmbedder } from "../lib/embedder"
import { createQdrantClient } from "../lib/qdrant"
import { createRetriever } from "../lib/retrieval"
import { createSlogansHandler } from "./api"
import { createChatHandler } from "./chat"

/** Directory that holds the static demo files. */
const DEMO_DIR = join(import.meta.dir, "..", "..", "demo")

/** Serve a file from `demo/`, or return 404. */
const serveStatic = async (pathname: string): Promise<Response> => {
	const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "")
	const target = normalize(join(DEMO_DIR, relative))

	if (target !== DEMO_DIR && !target.startsWith(DEMO_DIR + sep)) {
		return new Response("Not found", { status: 404 })
	}

	const file = Bun.file(target)

	if (!(await file.exists())) {
		return new Response("Not found", { status: 404 })
	}

	return new Response(file, { headers: { "content-type": file.type } })
}

const port = Number(process.env.PORT ?? 3000)
const embedder = await createEmbedder(process.env)
const client = createQdrantClient(process.env)
const retriever = createRetriever({ embedder, client, bm25: bm25Options(process.env) })
const slogans = createSlogansHandler({ retriever })
const chat = createChatHandler({ retriever, env: process.env })

const server = Bun.serve({
	port,
	async fetch(request) {
		const url = new URL(request.url)

		if (url.pathname === "/api/slogans") {
			return slogans(request)
		}

		if (url.pathname === "/api/chat") {
			return chat(request)
		}

		return serveStatic(url.pathname)
	},
})

console.log(`Listening on http://localhost:${server.port}`)
