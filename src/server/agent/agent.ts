/**
 * The conversational retrieval agent.
 *
 * The agent is a {@link ToolLoopAgent} built once per request. The tool set is concrete, so the
 * client can infer the typed UI message from the same agent shape through
 * {@link RetrievalAgentUIMessage}.
 */

import { type InferAgentUIMessage, type LanguageModel, ToolLoopAgent, stepCountIs } from "ai";
import type { createFetchNextPageTool, createSearchRecordsTool } from "./tools";

/** Maximum number of generation steps when the caller does not choose one. */
export const DEFAULT_MAX_STEPS = 6;

/** The tool set the agent runs with. */
export type RetrievalAgentTools = {
	/** Starts a weighted search. */
	searchRecords: ReturnType<typeof createSearchRecordsTool>;
	/** Continues a cached search. */
	fetchNextPage: ReturnType<typeof createFetchNextPageTool>;
};

/** Dependencies of the agent factory. */
export type RetrievalAgentDependencies = {
	/** Language model that drives the loop. */
	model: LanguageModel;
	/** Tools the model may call. */
	tools: RetrievalAgentTools;
	/** System prompt, loaded from the agent resource. */
	instructions?: string;
	/** Maximum number of generation steps. Defaults to {@link DEFAULT_MAX_STEPS}. */
	maxSteps?: number;
};

/**
 * Build the retrieval agent.
 *
 * @param dependencies - Model, tools, instructions, and step budget.
 * @returns A {@link ToolLoopAgent} bound to the given model and tools.
 */
export const createRetrievalAgent = (dependencies: RetrievalAgentDependencies) =>
	new ToolLoopAgent({
		model: dependencies.model,
		instructions: dependencies.instructions,
		tools: dependencies.tools,
		stopWhen: stepCountIs(dependencies.maxSteps ?? DEFAULT_MAX_STEPS)
	});

/** The concrete agent type, with the retrieval tool set. */
export type RetrievalAgent = ReturnType<typeof createRetrievalAgent>;

/** The UI message type of the retrieval agent, used on the client. */
export type RetrievalAgentUIMessage = InferAgentUIMessage<RetrievalAgent>;
