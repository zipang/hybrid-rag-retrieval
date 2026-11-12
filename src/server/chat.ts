/**
 * The `POST /api/chat` endpoint: the conversational retrieval agent.
 *
 * The handler resolves the agent resource for the conversation through the per-session cache, then
 * builds a {@link ToolLoopAgent} once per request. The agent is bound to the weighted retriever, a
 * per-conversation search store, and the resource's instructions. The handler returns the AI SDK UI
 * message stream, which carries the answer text and the tool parts that hold the sources.
 *
 * The handler never calls `convertToModelMessages`: the agent and `createAgentUIStreamResponse`
 * validate the UI messages and convert them.
 */

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createAgentUIStreamResponse, type LanguageModel, type UIMessage } from "ai";
import type { WeightedRetriever } from "../lib/retrieval";
import type { IndexWeights } from "../lib/retrieval-contract";
import { DEFAULT_MAX_STEPS, createRetrievalAgent } from "./agent/agent";
import type { AgentSessionCache } from "./agent/resource";
import type { SearchSessionStore } from "./agent/session-store";
import { createFetchNextPageTool, createSearchRecordsTool } from "./agent/tools";
import { ApiError, CORS_HEADERS, type SloganFields, jsonResponse } from "./api";

/** Environment variables that configure the chat provider. */
export type ChatEnv = {
	/** OpenAI-compatible base URL. */
	AI_PROVIDER_URL?: string;
	/** API key of the chat provider. */
	AI_API_KEY?: string;
	/** Chat model name. */
	AI_MODEL?: string;
	/** Extra environment values, so `process.env` is assignable. */
	[key: string]: string | undefined;
};

/** Identity that the OpenAI-compatible gateway expects. */
export type ChatIdentity = {
	/** User agent that names this application. */
	userAgent: string;
	/** Stable ID of the current conversation, sent in `x-opencode-session`. */
	sessionId: string;
};

/** Dependencies of the chat endpoint. Tests inject fakes. */
export type ChatDependencies = {
	/** Weighted retriever behind the two tools. */
	retriever: Pick<WeightedRetriever, "retrieveWeighted">;
	/** Search session store. */
	sessions: SearchSessionStore;
	/** Per-session agent cache, so the resource is read once per session. */
	agents: AgentSessionCache;
	/** Agent id used when the request does not name one. */
	defaultAgentId: string;
	/** Payload field names that map one hit to a typed source. */
	fields: SloganFields;
	/** Index weights the agent applies to every search. */
	weights: IndexWeights;
	/** Minimum combined score the agent applies to every search. */
	minScore: number;
	/** Chat provider configuration. */
	env: ChatEnv;
	/** Identity that the OpenAI-compatible gateway expects. */
	identity: ChatIdentity;
	/** Build the language model. Tests inject a fake. */
	createModel: (env: ChatEnv, identity: ChatIdentity) => LanguageModel;
	/** Maximum number of generation steps. Defaults to {@link DEFAULT_MAX_STEPS}. */
	maxSteps?: number;
};

/** Default index weights the agent applies to every search. */
export const DEFAULT_WEIGHTS: IndexWeights = { semantic: 0.5, keyword: 0.5 };

/** Default minimum combined score the agent applies to every search. */
export const DEFAULT_MIN_SCORE = 0.5;

/** The session identifier used when the request body carries no usable id. */
const ANONYMOUS_SESSION = "anonymous";

/**
 * Build the OpenAI-compatible chat model from the environment.
 *
 * The gateway needs two extra headers. It routes and caches by `x-opencode-session`, and it expects
 * a user agent that names the client instead of a generic SDK name.
 */
export const createChatModel = (env: ChatEnv, identity: ChatIdentity): LanguageModel => {
	const provider = createOpenAICompatible({
		name: "ai-provider",
		baseURL: env.AI_PROVIDER_URL ?? "https://api.openai.com/v1",
		apiKey: env.AI_API_KEY ?? "",
		headers: {
			"user-agent": identity.userAgent,
			"x-opencode-session": identity.sessionId
		}
	});

	return provider(env.AI_MODEL ?? "gpt-4o-mini");
};

/** Read the conversation identifier from the request body. */
const readSessionId = (id: unknown): string => {
	if (typeof id === "string" && id.trim() !== "") {
		return id;
	}

	return ANONYMOUS_SESSION;
};

/** Read the agent id from the request body, trimmed, falling back to the default. */
const readAgentId = (agentId: unknown, fallback: string): string => {
	if (typeof agentId === "string" && agentId.trim() !== "") {
		return agentId.trim();
	}

	return fallback;
};

/**
 * Create the `POST /api/chat` handler.
 *
 * @param dependencies - Retriever, session store, agent loader and cache, field names, weights,
 *   threshold, provider configuration, model factory, and step budget.
 * @returns The request handler.
 */
export const createChatHandler = (dependencies: ChatDependencies) => {
	return async (request: Request): Promise<Response> => {
		try {
			if (request.method === "OPTIONS") {
				return new Response(null, { status: 204, headers: CORS_HEADERS });
			}

			if (request.method !== "POST") {
				throw new ApiError(405, "Method not allowed.");
			}

			if (!dependencies.env.AI_API_KEY) {
				throw new ApiError(
					500,
					"AI_API_KEY is not set; the chat endpoint needs an LLM provider."
				);
			}

			const body = (await request.json()) as {
				id?: unknown;
				agentId?: unknown;
				messages?: UIMessage[];
			};

			if (!Array.isArray(body.messages) || body.messages.length === 0) {
				throw new ApiError(400, 'Body must contain a non-empty "messages" array.');
			}

			const sessionId = readSessionId(body.id);
			const agentId = readAgentId(body.agentId, dependencies.defaultAgentId);
			const resource = dependencies.agents.get(sessionId, agentId);
			const toolDependencies = {
				retriever: dependencies.retriever,
				sessions: dependencies.sessions,
				fields: dependencies.fields,
				weights: dependencies.weights,
				minScore: dependencies.minScore,
				sessionId
			};
			const tools = {
				searchRecords: createSearchRecordsTool(toolDependencies),
				fetchNextPage: createFetchNextPageTool(toolDependencies)
			};
			const agent = createRetrievalAgent({
				model: dependencies.createModel(dependencies.env, dependencies.identity),
				instructions: resource.instructions,
				tools,
				maxSteps: dependencies.maxSteps ?? DEFAULT_MAX_STEPS
			});

			return await createAgentUIStreamResponse({
				agent,
				uiMessages: body.messages,
				abortSignal: request.signal,
				onError: (error) => {
					console.error("[api/chat] stream error:", error);

					return "An error occurred.";
				}
			});
		} catch (error) {
			if (error instanceof ApiError) {
				return jsonResponse({ error: error.message }, error.status);
			}

			const message = error instanceof Error ? error.message : "Unexpected error.";

			return jsonResponse({ error: message }, 500);
		}
	};
};
