/**
 * Syntax parser configuration.
 *
 * The configuration names the local model file and the maximum accepted text
 * size. The model path comes from `UDPIPE_MODEL_PATH`. `scripts/init.sh`
 * downloads the pinned model to that path.
 *
 * This module builds a ready {@link Parser} from the environment. Later tasks
 * use it for the syntax backfill and for syntax queries.
 */

import { existsSync } from "node:fs"
import { createParser, type Parser, ParserUnavailableError } from "./parser"
import { createUdpipEngineLoader } from "./udpipe-engine"

/** Environment variables that configure the syntax parser. */
export type SyntaxEnv = {
	/** Local path to the `.udpipe` model file. */
	UDPIPE_MODEL_PATH?: string
	/** Optional override for the wasm binary path. */
	UDPIPE_WASM_PATH?: string
	/** Extra environment values, so `process.env` is assignable. */
	[key: string]: string | undefined
}

/** Default model path, relative to the project root. */
export const DEFAULT_MODEL_PATH = "models/french-gsd-ud-2.5-191206.udpipe"

/**
 * Read the model path from the environment.
 *
 * A blank value falls back to {@link DEFAULT_MODEL_PATH}.
 */
export const modelPath = (env: SyntaxEnv = {}): string => {
	const value = env.UDPIPE_MODEL_PATH

	return value === undefined || value.trim() === "" ? DEFAULT_MODEL_PATH : value
}

/**
 * Check that the parser model is present.
 *
 * Returns `true` when the file exists. Returns `false` otherwise. The caller
 * decides whether a missing model is fatal.
 */
export const isModelPresent = (env: SyntaxEnv = {}, cwd: string = process.cwd()): boolean => {
	const path = modelPath(env)

	return existsSync(path.startsWith("/") ? path : `${cwd}/${path}`)
}

/**
 * Create a syntax parser from the environment.
 *
 * The parser loads the model once on first use. A missing model raises
 * {@link ParserUnavailableError} on the first `parse` call, not here, so a
 * caller that never selects syntax pays no cost.
 */
export const createSyntaxParser = (env: SyntaxEnv = {}): Parser => {
	const path = modelPath(env)
	const options =
		env.UDPIPE_WASM_PATH === undefined
			? { modelPath: path }
			: { modelPath: path, wasmPath: env.UDPIPE_WASM_PATH }

	return createParser({ loadEngine: createUdpipEngineLoader(options) })
}

/** Re-export the parser error so a caller can map it to an HTTP status. */
export { ParserUnavailableError }
