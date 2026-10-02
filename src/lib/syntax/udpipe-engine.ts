/**
 * Real UDPipe engine loader.
 *
 * The npm wrapper `udpipe-wasm` exposes `loadParser`, but its `parse` returns a
 * tree without the `FEATS` column. The detailed profile needs those features.
 * The adapter therefore calls the underlying wasm `parseToConllu` directly,
 * through the package glue.
 *
 * The glue and the wasm binary are reached through the package `exports`. The
 * model is not bundled: the loader reads it from a configured path.
 *
 * The loader caches the engine after the first successful load, so the model is
 * read and initialised once.
 */

import { readFile } from "node:fs/promises"
import type { ParserEngine, ParserEngineLoader } from "./parser"

/** The minimal glue surface that this loader uses. */
type UdpipweWasmModule = {
	/** In-memory file system of the wasm module. */
	FS: {
		/** Write bytes to a virtual path. */
		writeFile: (path: string, data: Uint8Array) => void
	}
	/** Initialise the model from a virtual path. Return false on failure. */
	initModel: (path: string) => boolean
	/** Parse text and return one CoNLL-U block per sentence. */
	parseToConllu: (text: string) => string
}

/** Factory that the glue module default-exports. */
type UdpipGlueFactory = (options?: {
	locateFile?: (path: string) => string
}) => Promise<UdpipweWasmModule>

/** Options for the real engine loader. */
export type UdpipEngineOptions = {
	/** Local path to the `.udpipe` model file. */
	modelPath: string
	/** Optional override for the wasm binary path. */
	wasmPath?: string
}

/** Default glue specifier, resolved through the package exports map. */
const GLUE_SPECIFIER = "udpipe-wasm/udpipe.glue.cjs"

/**
 * Load the wasm glue module.
 *
 * The package ships the glue as a CommonJS file without types. This function
 * imports it dynamically and narrows the shape to {@link UdpipGlueFactory}.
 */
const loadGlue = async (): Promise<UdpipGlueFactory> => {
	const mod = (await import(GLUE_SPECIFIER)) as { default: UdpipGlueFactory }

	return mod.default
}

/**
 * Create a loader for the real UDPipe engine.
 *
 * The loader reads the model bytes, writes them into the wasm file system,
 * initialises the model, and returns an engine whose `parseToConllu` produces
 * the full CoNLL-U record. A missing model or a rejected init raises an error
 * that the adapter wraps into {@link ParserUnavailableError}.
 */
export const createUdpipEngineLoader = (options: UdpipEngineOptions): ParserEngineLoader => {
	let cached: ParserEngine | undefined

	return async (): Promise<ParserEngine> => {
		if (cached !== undefined) {
			return cached
		}

		const glideOptions =
			options.wasmPath === undefined ? undefined : { locateFile: () => options.wasmPath ?? "" }
		const createUdpip = await loadGlue()
		const mod = await createUdpip(glideOptions)
		const model = await readFile(options.modelPath)

		mod.FS.writeFile("/model.udpipe", new Uint8Array(model))

		if (!mod.initModel("/model.udpipe")) {
			throw new Error(`model failed to load from ${options.modelPath}`)
		}

		cached = {
			parseToConllu: (text: string) => mod.parseToConllu(text),
		}

		return cached
	}
}
