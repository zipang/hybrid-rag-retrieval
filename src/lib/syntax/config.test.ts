import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { SyntaxIndexConfiguration } from "../index-state";
import {
	ABSTRACTION_VERSIONS,
	buildSyntaxIndexConfiguration,
	createSyntaxParser,
	DEFAULT_MODEL_PATH,
	isModelPresent,
	modelPath,
	PARSER_PACKAGE_NAME,
	parserPackageVersion,
	readParserPackageIdentity,
	SYNTAX_LANGUAGE,
	syntaxConfigId,
	type SyntaxConfigurationFields,
	syntaxModelRevision,
	UDPIPE_MODEL_RELEASE,
	UDPIPE_MODEL_SHA256
} from "./config";
import { DEFAULT_ENCODER_CONFIG } from "./encoder";
import { EmptyInputError } from "./parser";

/** Minimal lock file text that resolves the parser package once. */
const LOCK = `{
  "lockfileVersion": 2,
  "packages": {
    "udpipe-wasm": ["udpipe-wasm@0.1.0", "", {}, "sha512-en9Ex7j8eBvtEVawoyUVJDAQlGPSIJoiGyEzlfAP7yQq4N/cbdxzyrijOzjhTS8gHxJNW4ligCmH1/gbptFmrw=="],
  },
}
`;

/** Copy a configuration into the fields that the fingerprint covers. */
const fieldsOf = (configuration: SyntaxIndexConfiguration): SyntaxConfigurationFields => ({
	mode: configuration.mode,
	language: configuration.language,
	parserVersion: configuration.parserVersion,
	modelRevision: configuration.modelRevision,
	abstractionVersion: configuration.abstractionVersion,
	encoderVersion: configuration.encoderVersion,
	dimensions: configuration.dimensions
});

describe("modelPath", () => {
	test("returns the default when the variable is absent or blank", () => {
		expect(modelPath()).toBe(DEFAULT_MODEL_PATH);
		expect(modelPath({ UDPIPE_MODEL_PATH: "  " })).toBe(DEFAULT_MODEL_PATH);
	});

	test("returns the configured path", () => {
		expect(modelPath({ UDPIPE_MODEL_PATH: "/opt/models/fr.udpipe" })).toBe(
			"/opt/models/fr.udpipe"
		);
	});
});

describe("isModelPresent", () => {
	test("returns false for a path that does not exist", () => {
		expect(isModelPresent({ UDPIPE_MODEL_PATH: "/nope/missing.udpipe" })).toBe(false);
	});

	test("returns true when the configured model exists", () => {
		const repoRoot = join(import.meta.dir, "..", "..", "..");
		const present = existsSync(join(repoRoot, DEFAULT_MODEL_PATH));

		expect(isModelPresent({}, repoRoot)).toBe(present);
	});
});

describe("createSyntaxParser", () => {
	test("returns a parser with a parse function", () => {
		const parser = createSyntaxParser();

		expect(typeof parser.parse).toBe("function");
	});

	test("raises EmptyInputError before it loads the model", async () => {
		const parser = createSyntaxParser({
			UDPIPE_MODEL_PATH: "/nope/missing.udpipe"
		});

		await expect(parser.parse("  ")).rejects.toBeInstanceOf(EmptyInputError);
	});

	test("raises ParserUnavailableError for a missing model on first parse", async () => {
		const parser = createSyntaxParser({
			UDPIPE_MODEL_PATH: "/nope/missing.udpipe"
		});

		await expect(parser.parse("Le garçon regarde le soleil.")).rejects.toThrow(
			/parser unavailable/
		);
	});
});

describe("parser identity", () => {
	test("reads the resolved parser version and integrity from the lockfile", async () => {
		const identity = await parserPackageVersion();

		expect(PARSER_PACKAGE_NAME).toBe("udpipe-wasm");
		expect(identity).toContain(`${PARSER_PACKAGE_NAME}@0.1.0`);
		expect(identity).toMatch(/\+sha512\.[A-Za-z0-9+/]{8}$/);
	});

	test("is stable across calls", async () => {
		const first = await parserPackageVersion();
		const second = await parserPackageVersion();

		expect(second).toBe(first);
	});

	test("retries after a failed read instead of caching the rejection", async () => {
		const failure = readParserPackageIdentity("{}");

		await expect(failure).rejects.toThrow(/does not resolve/);
		await expect(parserPackageVersion("{}")).rejects.toThrow(/does not resolve/);
		await expect(parserPackageVersion()).resolves.toContain("@0.1.0");
	});

	test("names the pinned model release, file, and checksum", () => {
		const revision = syntaxModelRevision();

		expect(revision).toContain(UDPIPE_MODEL_RELEASE);
		expect(revision).toContain("french-gsd-ud-2.5-191206.udpipe");
		expect(revision).toContain(UDPIPE_MODEL_SHA256);
	});
});

describe("readParserPackageIdentity", () => {
	test("reads the resolved version and the integrity prefix", async () => {
		expect(await readParserPackageIdentity(LOCK)).toBe("udpipe-wasm@0.1.0+sha512.en9Ex7j8");
	});

	test("changes when the resolved version changes", async () => {
		const next = LOCK.replace("udpipe-wasm@0.1.0", "udpipe-wasm@0.2.0");
		const identity = await readParserPackageIdentity(next);

		expect(identity).toContain("udpipe-wasm@0.2.0+sha512.");
		expect(identity).not.toBe(await readParserPackageIdentity(LOCK));
	});

	test("changes when the integrity changes", async () => {
		const next = LOCK.replace("sha512-en9Ex7j8", "sha512-ZZZZZZZZ");
		const identity = await readParserPackageIdentity(next);

		expect(identity).toContain("+sha512.ZZZZZZZZ");
		expect(identity).not.toBe(await readParserPackageIdentity(LOCK));
	});

	test("accepts a versioned key when the package is not a plain entry", async () => {
		const versioned = LOCK.replace('"udpipe-wasm": [', '"udpipe-wasm@0.1.0": [');

		expect(await readParserPackageIdentity(versioned)).toBe(
			"udpipe-wasm@0.1.0+sha512.en9Ex7j8"
		);
	});

	test("names the ambiguity when several versions resolve", async () => {
		const duplicated = LOCK.replace(
			'"udpipe-wasm": [',
			'"udpipe-wasm": ["udpipe-wasm@0.1.0", "", {}, "sha512-aaaaaaaa"],\n    "udpipe-wasm@0.2.0": ['
		);

		await expect(readParserPackageIdentity(duplicated)).rejects.toThrow(/more than one/);
	});

	test("raises a distinct message for a missing entry", async () => {
		await expect(readParserPackageIdentity('{"packages": {}}')).rejects.toThrow(
			/does not resolve/
		);
	});

	test("raises a distinct message for a versionless entry", async () => {
		const versionless = LOCK.replace("udpipe-wasm@0.1.0", "udpipe-wasm");

		await expect(readParserPackageIdentity(versionless)).rejects.toThrow(/no resolved version/);
	});

	test("raises a distinct message for a non-sha512 integrity", async () => {
		const broken = LOCK.replace("sha512-en9Ex7j8", "sha256-en9Ex7j8");

		await expect(readParserPackageIdentity(broken)).rejects.toThrow(/no sha512 integrity/);
	});
});

describe("buildSyntaxIndexConfiguration", () => {
	test("builds the coarse identity from the frozen components", async () => {
		const configuration = await buildSyntaxIndexConfiguration("coarse");

		expect(configuration.mode).toBe("coarse");
		expect(configuration.language).toBe(SYNTAX_LANGUAGE);
		expect(configuration.parserVersion).toBe(await parserPackageVersion());
		expect(configuration.modelRevision).toBe(syntaxModelRevision());
		expect(configuration.abstractionVersion).toBe(ABSTRACTION_VERSIONS.coarse);
		expect(configuration.encoderVersion).toBe(DEFAULT_ENCODER_CONFIG.version);
		expect(configuration.dimensions).toBe(DEFAULT_ENCODER_CONFIG.dimensions);
	});

	test("puts the resolved parser version and integrity into the identity", async () => {
		const configuration = await buildSyntaxIndexConfiguration("coarse");

		expect(configuration.parserVersion).toContain("udpipe-wasm@0.1.0+sha512.");
	});

	test("builds a detailed identity so the deferred mode needs no interface change", async () => {
		const configuration = await buildSyntaxIndexConfiguration("detailed");

		expect(configuration.mode).toBe("detailed");
	});

	test("computes a 16-character lowercase hexadecimal configId", async () => {
		const configuration = await buildSyntaxIndexConfiguration("coarse");

		expect(configuration.configId).toMatch(/^[0-9a-f]{16}$/);
	});
});

describe("syntaxConfigId", () => {
	test("is stable across two builds of the same configuration", async () => {
		const first = await buildSyntaxIndexConfiguration("coarse");
		const second = await buildSyntaxIndexConfiguration("coarse");

		expect(first.configId).toBe(second.configId);
	});

	test("does not depend on the key order of the fields", async () => {
		const configuration = await buildSyntaxIndexConfiguration("coarse");
		const fields = fieldsOf(configuration);
		const reordered: SyntaxConfigurationFields = {
			dimensions: fields.dimensions,
			encoderVersion: fields.encoderVersion,
			abstractionVersion: fields.abstractionVersion,
			modelRevision: fields.modelRevision,
			parserVersion: fields.parserVersion,
			language: fields.language,
			mode: fields.mode
		};

		expect(await syntaxConfigId(reordered)).toBe(configuration.configId);
	});

	test("changes when the mode changes", async () => {
		const coarse = await buildSyntaxIndexConfiguration("coarse");
		const detailed = await buildSyntaxIndexConfiguration("detailed");

		expect(detailed.configId).not.toBe(coarse.configId);
	});

	test("changes when the encoder version changes", async () => {
		const configuration = await buildSyntaxIndexConfiguration("coarse");
		const fields = fieldsOf(configuration);
		const changed = { ...fields, encoderVersion: `${fields.encoderVersion}-next` };

		expect(await syntaxConfigId(changed)).not.toBe(configuration.configId);
	});

	test("changes when the dimensions change", async () => {
		const configuration = await buildSyntaxIndexConfiguration("coarse");
		const fields = fieldsOf(configuration);
		const changed = { ...fields, dimensions: fields.dimensions * 2 };

		expect(await syntaxConfigId(changed)).not.toBe(configuration.configId);
	});
});
