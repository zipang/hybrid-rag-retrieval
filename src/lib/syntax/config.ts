/**
 * Syntax parser configuration and reproducible index identity.
 *
 * The configuration names the local model file and the maximum accepted text size. The model path
 * comes from `UDPIPE_MODEL_PATH`. `scripts/init.sh` downloads the pinned model to that path.
 *
 * This module also builds the {@link SyntaxIndexConfiguration} that a syntax index run persists.
 * The identity of one syntax index is the whole tuple: the mode, the language, the parser package
 * version, the pinned model revision, the abstraction version, the encoder version, and the vector
 * dimensions. {@link syntaxConfigId} turns that tuple into a stable fingerprint, so two runs with
 * the same configuration publish the same `configId` and a changed component publishes a new one.
 *
 * Later tasks use this module for the syntax backfill and for syntax queries.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { SyntaxIndexConfiguration } from "../index-state";
import type { SyntaxMode } from "./abstraction";
import { DEFAULT_ENCODER_CONFIG } from "./encoder";
import { createParser, type Parser, ParserUnavailableError } from "./parser";
import { createUdpipEngineLoader } from "./udpipe-engine";

/** Environment variables that configure the syntax parser. */
export type SyntaxEnv = {
	/** Local path to the `.udpipe` model file. */
	UDPIPE_MODEL_PATH?: string;
	/** Optional override for the wasm binary path. */
	UDPIPE_WASM_PATH?: string;
	/** Extra environment values, so `process.env` is assignable. */
	[key: string]: string | undefined;
};

/** Parser package that the adapter wraps. */
export const PARSER_PACKAGE_NAME = "udpipe-wasm";

/** Length of the integrity prefix kept in the parser identity. */
const INTEGRITY_PREFIX_LENGTH = 8;

/** One resolved package entry of `bun.lock`. */
type LockedPackage = [
	name: string,
	registry: string,
	metadata: Record<string, unknown>,
	integrity?: string
];

/** UDPipe model treebank stem, matching `scripts/init.sh`. */
export const UDPIPE_MODEL_NAME = "french-gsd";

/** Pinned UDPipe model release, matching `scripts/init.sh`. */
export const UDPIPE_MODEL_RELEASE = "ud-2.5-191206";

/** File name of the pinned UDPipe model, matching `scripts/init.sh`. */
export const UDPIPE_MODEL_FILE = `${UDPIPE_MODEL_NAME}-${UDPIPE_MODEL_RELEASE}.udpipe`;

/** SHA-256 checksum of the pinned model, matching `scripts/init.sh`. */
export const UDPIPE_MODEL_SHA256 =
	"3b10b4c87e7667ac4cf5b301fa075720303c6a1d101cd11a62abde670bebea30";

/** Default model path, relative to the project root. */
export const DEFAULT_MODEL_PATH = `models/${UDPIPE_MODEL_FILE}`;

/** Language of the parsed texts for this ticket. */
export const SYNTAX_LANGUAGE = "fr";

/**
 * Abstraction version per mode.
 *
 * The constant lives here, not in `abstraction.ts`, because the ticket scope keeps that module
 * untouched. It names the rule set that removes the vocabulary and selects the grammatical details.
 * The `coarse` rule set is frozen. The `detailed` rule set is declared only, because the detailed
 * branch is deferred to a future ticket.
 */
export const ABSTRACTION_VERSIONS: Record<SyntaxMode, string> = {
	coarse: "coarse-1",
	detailed: "detailed-0"
};

/**
 * Return the pinned model revision string.
 *
 * The string carries the model release, the model file name, and the checksum, so a changed model
 * changes the configuration fingerprint.
 */
export const syntaxModelRevision = (): string =>
	`${UDPIPE_MODEL_RELEASE}:${UDPIPE_MODEL_FILE}:sha256:${UDPIPE_MODEL_SHA256}`;

/** Cached resolved parser identity. Only a resolved string is cached, never a rejection. */
let parserVersionCache: string | undefined;

/** Path of the lock file, used in error messages. */
const LOCK_PATH = join(import.meta.dir, "..", "..", "..", "bun.lock");

/**
 * Build the identity of one resolved parser entry.
 *
 * @param lockPath Lock file path, used in error messages only.
 * @param entry Resolved lock entry.
 * @returns `<package>@<version>+sha512.<8 chars>`.
 */
const identityOf = (lockPath: string, entry: LockedPackage): string => {
	const [resolved, , , integrity] = entry;
	const separator = resolved.lastIndexOf("@");
	const version = separator === -1 ? "" : resolved.slice(separator + 1);

	if (version === "") {
		throw new Error(`${lockPath} has no resolved version for ${PARSER_PACKAGE_NAME}`);
	}

	if (integrity === undefined || !integrity.startsWith("sha512-")) {
		throw new Error(`${lockPath} has no sha512 integrity for ${PARSER_PACKAGE_NAME}`);
	}

	// `sha512-<base64>` becomes `sha512.<8 chars of base64>`, which stays readable and stable.
	const prefix = integrity.slice("sha512-".length, "sha512-".length + INTEGRITY_PREFIX_LENGTH);

	return `${PARSER_PACKAGE_NAME}@${version}+sha512.${prefix}`;
};

/**
 * Read the parser package entry from `bun.lock`.
 *
 * The manifest declares a range such as `^0.1.0`, so a lockfile bump inside that range would leave
 * a manifest-only identity unchanged. The lock file pins the resolved version and its integrity
 * hash, which is the identity that a stored vector actually depends on.
 *
 * Bun stores a package that resolves once under a plain key (`udpipe-wasm`) and several resolutions
 * under versioned keys (`udpipe-wasm@0.1.0`). Both shapes are accepted. Two entries at once are
 * ambiguous and raise a message that names the ambiguity.
 *
 * @param lockText Lock file text. Defaults to reading `bun.lock` from the project root.
 * @returns The resolved identity of the parser package.
 */
export const readParserPackageIdentity = async (lockText?: string): Promise<string> => {
	let raw = lockText;
	let lockPath = LOCK_PATH;

	if (raw === undefined) {
		try {
			raw = await Bun.file(LOCK_PATH).text();
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);

			throw new Error(`cannot read ${LOCK_PATH}: ${reason}`);
		}
	} else {
		lockPath = "<injected lock text>";
	}

	let packages: Record<string, LockedPackage | undefined>;

	try {
		const parsed = Bun.JSONC.parse(raw) as {
			packages?: Record<string, LockedPackage | undefined>;
		};
		packages = parsed.packages ?? {};
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);

		throw new Error(`cannot parse ${lockPath}: ${reason}`);
	}

	const matches = Object.entries(packages).filter(
		([key]) => key === PARSER_PACKAGE_NAME || key.startsWith(`${PARSER_PACKAGE_NAME}@`)
	);

	if (matches.length === 0) {
		throw new Error(`${lockPath} does not resolve ${PARSER_PACKAGE_NAME}`);
	}

	if (matches.length > 1) {
		const keys = matches.map(([key]) => key).join(", ");

		throw new Error(
			`${lockPath} resolves ${PARSER_PACKAGE_NAME} more than one way (${keys}), so the ` +
				"parser identity is ambiguous"
		);
	}

	const entry = matches[0]?.[1];

	if (entry === undefined) {
		throw new Error(`${lockPath} does not resolve ${PARSER_PACKAGE_NAME}`);
	}

	return identityOf(lockPath, entry);
};

/**
 * Return the resolved identity of the parser package.
 *
 * The identity reads `bun.lock`, not the version range of `package.json`, so a lockfile bump inside
 * the declared range changes the configuration fingerprint. The value looks like
 * `udpipe-wasm@0.1.0+sha512.en9Ex7j8`, and the lock file is read once per process.
 *
 * Only a resolved identity is cached. A failed read or a failed parse leaves the cache empty, so
 * the next call retries instead of repeating a rejection for the life of the process.
 *
 * @param lockText Lock file text to parse instead of reading `bun.lock`. Such a call never touches
 *   the cache, so a test cannot poison the process-wide identity.
 * @returns The resolved identity of the parser package.
 */
export const parserPackageVersion = (lockText?: string): Promise<string> => {
	if (lockText !== undefined) {
		return readParserPackageIdentity(lockText);
	}

	if (parserVersionCache !== undefined) {
		return Promise.resolve(parserVersionCache);
	}

	return readParserPackageIdentity().then((identity) => {
		parserVersionCache = identity;

		return identity;
	});
};

/** The identity fields that the configuration fingerprint covers. */
export type SyntaxConfigurationFields = Omit<SyntaxIndexConfiguration, "configId">;

/**
 * Return the canonical JSON of the identity fields.
 *
 * The keys are sorted, so two objects with the same values in a different insertion order produce
 * the same string.
 */
const canonicalFields = (fields: SyntaxConfigurationFields): string => {
	const entries = Object.entries(fields).sort(([left], [right]) =>
		left < right ? -1 : left > right ? 1 : 0
	);

	return JSON.stringify(entries);
};

/**
 * Compute the stable fingerprint of a syntax configuration.
 *
 * The fingerprint is the first 16 hexadecimal characters of the SHA-256 digest of the canonical
 * JSON of every identity field. The same fields always give the same value, and a changed field
 * gives a different value.
 */
export const syntaxConfigId = async (fields: SyntaxConfigurationFields): Promise<string> => {
	const canonical = canonicalFields(fields);
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));

	return Buffer.from(digest).toString("hex").slice(0, 16);
};

/**
 * Build the reproducible configuration of one syntax index run.
 *
 * The mode is a parameter, so the deferred `detailed` mode needs no interface change. Every other
 * field comes from a frozen component: the parser manifest, the pinned model, the abstraction rule
 * set, or the encoder configuration.
 */
export const buildSyntaxIndexConfiguration = async (
	mode: SyntaxMode
): Promise<SyntaxIndexConfiguration> => {
	const fields: SyntaxConfigurationFields = {
		mode,
		language: SYNTAX_LANGUAGE,
		parserVersion: await parserPackageVersion(),
		modelRevision: syntaxModelRevision(),
		abstractionVersion: ABSTRACTION_VERSIONS[mode],
		encoderVersion: DEFAULT_ENCODER_CONFIG.version,
		dimensions: DEFAULT_ENCODER_CONFIG.dimensions
	};

	return { ...fields, configId: await syntaxConfigId(fields) };
};

/**
 * Read the model path from the environment.
 *
 * A blank value falls back to {@link DEFAULT_MODEL_PATH}.
 */
export const modelPath = (env: SyntaxEnv = {}): string => {
	const value = env.UDPIPE_MODEL_PATH;

	return value === undefined || value.trim() === "" ? DEFAULT_MODEL_PATH : value;
};

/**
 * Check that the parser model is present.
 *
 * Returns `true` when the file exists. Returns `false` otherwise. The caller decides whether a
 * missing model is fatal.
 */
export const isModelPresent = (env: SyntaxEnv = {}, cwd: string = process.cwd()): boolean => {
	const path = modelPath(env);

	return existsSync(path.startsWith("/") ? path : `${cwd}/${path}`);
};

/**
 * Create a syntax parser from the environment.
 *
 * The parser loads the model once on first use. A missing model raises
 * {@link ParserUnavailableError} on the first `parse` call, not here, so a caller that never selects
 * syntax pays no cost.
 */
export const createSyntaxParser = (env: SyntaxEnv = {}): Parser => {
	const path = modelPath(env);
	const options =
		env.UDPIPE_WASM_PATH === undefined
			? { modelPath: path }
			: { modelPath: path, wasmPath: env.UDPIPE_WASM_PATH };

	return createParser({ loadEngine: createUdpipEngineLoader(options) });
};

/** Re-export the parser error so a caller can map it to an HTTP status. */
export { ParserUnavailableError };
