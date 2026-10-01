import type { RetrievalOptions, Retriever } from "../lib/retrieval"

/** Dependencies of the JSON API. Tests inject a fake retriever. */
export type ApiDependencies = {
	/** Hybrid retriever over the slogan collection. */
	retriever: Pick<Retriever, "retrieveHybrid">
}

/** Error with an HTTP status for the JSON API. */
export class ApiError extends Error {
	/** HTTP status code. */
	readonly status: number

	/** Create an API error with a status and a client message. */
	constructor(status: number, message: string) {
		super(message)
		this.status = status
	}
}

/** CORS headers for the JSON API. */
const CORS_HEADERS = {
	"access-control-allow-origin": "*",
	"access-control-allow-methods": "GET, OPTIONS",
	"access-control-allow-headers": "content-type",
}

/** Build a JSON response with the CORS headers. */
export const jsonResponse = (body: unknown, status = 200): Response =>
	Response.json(body, { status, headers: CORS_HEADERS })

/** Read an optional integer query parameter or throw a 400 error. */
const readInteger = (params: URLSearchParams, name: string): number | undefined => {
	const raw = params.get(name)

	if (raw === null || raw.trim() === "") {
		return undefined
	}

	const value = Number(raw)

	if (!Number.isSafeInteger(value)) {
		throw new ApiError(400, `Query parameter "${name}" must be an integer.`)
	}

	return value
}

/**
 * Create the `GET /api/slogans` handler.
 *
 * The handler reads `q`, `topK`, `yearFrom`, and `yearTo`, then calls the
 * retriever. It answers OPTIONS preflight requests and maps every error to a
 * JSON response with a status code.
 */
export const createSlogansHandler = (dependencies: ApiDependencies) => {
	return async (request: Request): Promise<Response> => {
		try {
			if (request.method === "OPTIONS") {
				return new Response(null, { status: 204, headers: CORS_HEADERS })
			}

			if (request.method !== "GET") {
				throw new ApiError(405, "Method not allowed.")
			}

			const params = new URL(request.url).searchParams
			const query = (params.get("q") ?? "").trim()

			if (query === "") {
				throw new ApiError(400, 'Query parameter "q" is required.')
			}

			const options: RetrievalOptions = {
				topK: readInteger(params, "topK"),
				yearFrom: readInteger(params, "yearFrom"),
				yearTo: readInteger(params, "yearTo"),
			}
			const results = await dependencies.retriever.retrieveHybrid(query, options)

			return jsonResponse({ results })
		} catch (error) {
			if (error instanceof ApiError) {
				return jsonResponse({ error: error.message }, error.status)
			}

			const message = error instanceof Error ? error.message : "Unexpected error."

			return jsonResponse({ error: message }, 500)
		}
	}
}
