import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import {
	convertToModelMessages,
	jsonSchema,
	stepCountIs,
	streamText,
	tool,
	type UIMessage,
} from "ai"
import type { RetrievalOptions, Retriever } from "../lib/slogan-retrieval"
import { sloganJsonSchema } from "../models/slogan"
import { ApiError, CORS_HEADERS, jsonResponse } from "./api"

/** Environment variables that configure the chat provider. */
export type ChatEnv = {
	/** OpenAI-compatible base URL. */
	AI_PROVIDER_URL?: string
	/** API key of the chat provider. */
	AI_API_KEY?: string
	/** Chat model name. */
	AI_MODEL?: string
	/** Extra environment values, so `process.env` is assignable. */
	[key: string]: string | undefined
}

/** Identity that the chat sends to the OpenCode Go gateway. */
export type ChatIdentity = {
	/** User agent that names this application. */
	userAgent: string
	/** Stable ID of the current conversation, sent in `x-opencode-session`. */
	sessionId: string
}

/** Input of the `searchSlogans` tool. */
export type SearchInput = {
	/** Natural-language search text. */
	query: string
	/** Maximum number of results. */
	topK?: number
	/** Lower publication year bound, inclusive. */
	yearFrom?: number
	/** Upper publication year bound, inclusive. */
	yearTo?: number
}

/** One slogan that the tool returns to the model. */
export type SloganSearchResult = {
	/** Fused RRF score. */
	score: number
	/** Publication year. */
	annee: number
	/** Brand or issuing organization. */
	marque: string
	/** Slogan text. */
	slogan: string
}

/** Dependencies of the chat endpoint. Tests inject a fake retriever. */
export type ChatDependencies = {
	/** Hybrid retriever behind the `searchSlogans` tool. */
	retriever: Pick<Retriever, "retrieveHybrid">
	/** Chat provider configuration. */
	env: ChatEnv
	/** Identity that the OpenCode Go gateway expects. */
	identity: ChatIdentity
}

/**
 * Build the system prompt from the slogan schema descriptions.
 *
 * The schema marks each field as a content field, a filter field, or the record
 * identifier. The prompt repeats those roles so the model selects the correct
 * search text and filters.
 */
export const buildSystemPrompt = (): string => {
	const fields = Object.entries(sloganJsonSchema.properties).map(
		([key, field]) => `- ${key}: ${field.description}`,
	)

	return [
		"You answer questions about a collection of advertising slogans.",
		"Call the searchSlogans tool before every answer.",
		"Answer only from the slogans that the tool returns.",
		"Cite each slogan with its brand (marque) and its year (annee).",
		"Use the content field as search text and the filter fields as filters.",
		"Write plain text. Do not use Markdown, bold, or tables.",
		"",
		"Slogan fields:",
		...fields,
	].join("\n")
}

/** Run a slogan search for the tool and shape the result for the model. */
export const searchSlogans = async (
	retriever: Pick<Retriever, "retrieveHybrid">,
	input: SearchInput,
): Promise<SloganSearchResult[]> => {
	const options: RetrievalOptions = {
		topK: input.topK,
		yearFrom: input.yearFrom,
		yearTo: input.yearTo,
	}
	const hits = await retriever.retrieveHybrid(input.query, options)

	return hits.map((hit) => ({
		score: hit.score,
		annee: hit.annee,
		marque: hit.marque,
		slogan: hit.slogan,
	}))
}

/** Create the `searchSlogans` tool that wraps hybrid retrieval. */
export const createSearchSlogansTool = (retriever: Pick<Retriever, "retrieveHybrid">) =>
	tool({
		description: "Search the slogan corpus with a hybrid semantic and keyword query.",
		inputSchema: jsonSchema<SearchInput>({
			type: "object",
			properties: {
				query: { type: "string", description: "Natural-language search text." },
				topK: { type: "number", description: "Maximum number of results. Defaults to 5." },
				yearFrom: { type: "number", description: "Lower publication year bound, inclusive." },
				yearTo: { type: "number", description: "Upper publication year bound, inclusive." },
			},
			required: ["query"],
			additionalProperties: false,
		}),
		execute: (input) => searchSlogans(retriever, input),
	})

/**
 * Build the OpenAI-compatible chat model from the environment.
 *
 * The OpenCode Go gateway needs two extra headers. It routes and caches by
 * `x-opencode-session`, and it expects a user agent that names the client
 * instead of a generic SDK name.
 */
const createModel = (env: ChatEnv, identity: ChatIdentity) => {
	const provider = createOpenAICompatible({
		name: "ai-provider",
		baseURL: env.AI_PROVIDER_URL ?? "https://api.openai.com/v1",
		apiKey: env.AI_API_KEY ?? "",
		headers: {
			"user-agent": identity.userAgent,
			"x-opencode-session": identity.sessionId,
		},
	})

	return provider(env.AI_MODEL ?? "gpt-4o-mini")
}

/**
 * Create the `POST /api/chat` handler.
 *
 * The handler streams a text answer with the AI SDK. The model calls the
 * `searchSlogans` tool, which wraps hybrid retrieval. A missing API key returns
 * a clear 500 JSON error before any model call.
 */
export const createChatHandler = (dependencies: ChatDependencies) => {
	return async (request: Request): Promise<Response> => {
		try {
			if (request.method === "OPTIONS") {
				return new Response(null, { status: 204, headers: CORS_HEADERS })
			}

			if (request.method !== "POST") {
				throw new ApiError(405, "Method not allowed.")
			}

			if (!dependencies.env.AI_API_KEY) {
				throw new ApiError(500, "AI_API_KEY is not set; the chat endpoint needs an LLM provider.")
			}

			const body = (await request.json()) as { messages?: Array<Omit<UIMessage, "id">> }

			if (!Array.isArray(body.messages) || body.messages.length === 0) {
				throw new ApiError(400, 'Body must contain a non-empty "messages" array.')
			}

			const tools = { searchSlogans: createSearchSlogansTool(dependencies.retriever) }
			const result = streamText({
				model: createModel(dependencies.env, dependencies.identity),
				system: buildSystemPrompt(),
				messages: await convertToModelMessages(body.messages, { tools }),
				tools,
				stopWhen: stepCountIs(5),
				onError: ({ error }) => {
					console.error("[api/chat] stream error:", error)
				},
			})

			return result.toTextStreamResponse()
		} catch (error) {
			if (error instanceof ApiError) {
				return jsonResponse({ error: error.message }, error.status)
			}

			const message = error instanceof Error ? error.message : "Unexpected error."

			return jsonResponse({ error: message }, 500)
		}
	}
}
