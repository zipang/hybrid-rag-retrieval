/**
 * Build `datasets/citations.txt` from the French and English Wikiquote dumps.
 *
 * Usage:
 *   bun run scripts/build-citations.ts
 *   bun run scripts/build-citations.ts --lang fr
 *   bun run scripts/build-citations.ts --limit 500 --dry
 *
 * The script downloads nothing. Put the dumps in `.tmp/` first:
 *   curl -sSL -o .tmp/frwikiquote-pages-articles.xml.bz2 \
 *     https://dumps.wikimedia.org/frwikiquote/latest/frwikiquote-latest-pages-articles.xml.bz2
 */

import { datasetConfigurations } from "../src/config/datasets"
import {
	extractAttributedCitations,
	extractPageCitations,
	isAcceptableQuote,
	isInScope,
	isNonArticlePage,
	normalizeAuthor,
	parsePageBlock,
} from "./citations/pages"
import type { RawCitation } from "./citations/wikitext"

/** Command-line options for the build. */
type BuildOptions = {
	lang: "fr" | "en" | "both"
	outPath: string
	limit: number | undefined
	maxPages: number | undefined
	dry: boolean
}

/** Per-language dump locations. */
const DUMP_FILES: Record<"fr" | "en", string> = {
	fr: ".tmp/frwikiquote-pages-articles.xml.bz2",
	en: ".tmp/enwikiquote-pages-articles.xml.bz2",
}

/** Running counters that explain how many records the build kept or dropped. */
type BuildStats = {
	pages: number
	inScopePages: number
	citations: number
	accepted: number
	duplicates: number
	inferredYears: number
	anonymous: number
	outOfScope: number
	dropped: Record<string, number>
	byLanguage: Record<"fr" | "en", number>
	authors: Set<string>
}

/** Parse the command-line arguments into build options. */
const parseOptions = (argv: string[]): BuildOptions => {
	const options: BuildOptions = {
		lang: "both",
		outPath: datasetConfigurations.citations.filePath,
		limit: undefined,
		maxPages: undefined,
		dry: false,
	}

	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index]

		if (argument === "--lang") {
			const value = argv[index + 1]

			if (value === "fr" || value === "en" || value === "both") {
				options.lang = value
			}

			index += 1
			continue
		}

		if (argument === "--out") {
			options.outPath = argv[index + 1] ?? options.outPath
			index += 1
			continue
		}

		if (argument === "--limit") {
			options.limit = Number(argv[index + 1])
			index += 1
			continue
		}

		if (argument === "--max-pages") {
			options.maxPages = Number(argv[index + 1])
			index += 1
			continue
		}

		if (argument === "--dry") {
			options.dry = true
		}
	}

	return options
}

/** Record a drop reason in the stats counters. */
const drop = (stats: BuildStats, reason: string): void => {
	stats.dropped[reason] = (stats.dropped[reason] ?? 0) + 1
}

/** Normalize a work title into a stable lookup key. */
export const normalizeWork = (work: string): string => {
	return work
		.toLocaleLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.replace(/^(?:the|a|an|les|la|le|un|une|des|du|de|los|las|el)\s+/u, "")
		.replace(/\s+/g, " ")
		.trim()
}

/** Build a work-title to publication-year lookup from dated citations. */
export const buildWorkYearIndex = (citations: RawCitation[]): Map<string, number> => {
	const counts = new Map<string, Map<number, number>>()

	for (const citation of citations) {
		const key = normalizeWork(citation.work)

		if (key.length === 0 || citation.year === undefined) {
			continue
		}

		const years = counts.get(key) ?? new Map<number, number>()
		years.set(citation.year, (years.get(citation.year) ?? 0) + 1)
		counts.set(key, years)
	}

	const index = new Map<string, number>()

	for (const [key, years] of counts) {
		const ranked = [...years.entries()].sort(
			(left, right) => right[1] - left[1] || left[0] - right[0],
		)

		if (ranked.length > 0) {
			index.set(key, ranked[0][0])
		}
	}

	return index
}

/** Fill missing years from the work-title index and count the recoveries. */
export const inferMissingYears = (citations: RawCitation[], index: Map<string, number>): number => {
	let inferred = 0

	for (const citation of citations) {
		if (citation.year !== undefined) {
			continue
		}

		const year = index.get(normalizeWork(citation.work))

		if (year !== undefined) {
			citation.year = year
			inferred += 1
		}
	}

	return inferred
}

/** Turn one accepted citation into a corpus block. */
const formatRecord = (id: number, citation: RawCitation): string => {
	const lines = [
		`id: ${id}`,
		`author: ${citation.author}`,
		`work: ${citation.work}`,
		`lang: ${citation.lang}`,
		`trad: ${citation.trad}`,
		`quote: ${citation.quote}`,
	]

	if (citation.year !== undefined) {
		lines.splice(3, 0, `year: ${citation.year}`)
	}

	return `${lines.join("\n")}\n---\n`
}

/** Pass over the dumps: author pages first, then attributed theme and work pages. */
type PassMode = "authors" | "attributed"

/** Stream one decompressed dump and collect citations for the given pass. */
const processDump = async (
	path: string,
	lang: "fr" | "en",
	options: BuildOptions,
	stats: BuildStats,
	mode: PassMode,
	collected: RawCitation[],
	allowedAuthors: Set<string>,
): Promise<void> => {
	const process = Bun.spawn(["bzip2", "-dc", path], { stdout: "pipe" })
	const decoder = new TextDecoder()
	let buffer = ""
	let pageCount = 0

	for await (const chunk of process.stdout) {
		buffer += decoder.decode(chunk, { stream: true })
		let end = buffer.indexOf("</page>")

		while (end !== -1) {
			const block = buffer.slice(0, end)
			buffer = buffer.slice(end + "</page>".length)
			end = buffer.indexOf("</page>")

			if (block.indexOf("<page>") === -1) {
				continue
			}

			const page = parsePageBlock(block)

			if (page === undefined) {
				continue
			}

			pageCount += 1
			stats.pages += 1

			if (mode === "authors" && isInScope(page)) {
				stats.inScopePages += 1
				const citations = extractPageCitations(page, lang)

				allowedAuthors.add(normalizeAuthor(page.title))

				for (const citation of citations) {
					allowedAuthors.add(normalizeAuthor(citation.author))
				}

				collected.push(...citations)
			}

			const hasQuoteMaterial =
				page.text.length > 200 &&
				page.text.includes("[[") &&
				(page.text.includes("*") || page.text.includes("{{citation"))

			if (
				mode === "attributed" &&
				hasQuoteMaterial &&
				page.namespace === 0 &&
				!isInScope(page) &&
				!isNonArticlePage(page)
			) {
				for (const citation of extractAttributedCitations(page, lang)) {
					if (allowedAuthors.has(normalizeAuthor(citation.author))) {
						collected.push(citation)
					} else {
						stats.outOfScope += 1
					}
				}
			}

			if (options.maxPages !== undefined && pageCount >= options.maxPages) {
				process.kill()
				return
			}
		}
	}

	await process.exited
}

/** Filter, deduplicate, and serialize the collected citations. */
const finalize = (citations: RawCitation[], stats: BuildStats): string[] => {
	const seen = new Set<string>()
	const out: string[] = []

	for (const citation of citations) {
		stats.citations += 1

		if (citation.work.trim().length === 0) {
			drop(stats, "no-work")
			continue
		}

		if (citation.author.trim().length === 0) {
			citation.author = "Anonymous"
			stats.anonymous += 1
		}

		if (!isAcceptableQuote(citation)) {
			drop(stats, "unacceptable-quote")
			continue
		}

		const key = `${citation.lang}|${citation.quote.toLocaleLowerCase()}`

		if (seen.has(key)) {
			stats.duplicates += 1
			continue
		}

		seen.add(key)
		stats.accepted += 1
		stats.byLanguage[citation.lang] += 1
		stats.authors.add(citation.author)
		out.push(formatRecord(stats.accepted, citation))
	}

	return out
}

/** Build the citations corpus from the configured dumps. */
const main = async (): Promise<void> => {
	const options = parseOptions(process.argv.slice(2))
	const stats: BuildStats = {
		pages: 0,
		inScopePages: 0,
		citations: 0,
		accepted: 0,
		duplicates: 0,
		inferredYears: 0,
		anonymous: 0,
		outOfScope: 0,
		dropped: {},
		byLanguage: { fr: 0, en: 0 },
		authors: new Set<string>(),
	}
	const collected: RawCitation[] = []
	const allowedAuthors = new Set<string>()

	const languages: Array<"fr" | "en"> = options.lang === "both" ? ["fr", "en"] : [options.lang]

	for (const lang of languages) {
		if (!(await Bun.file(DUMP_FILES[lang]).exists())) {
			console.error(`Missing dump: ${DUMP_FILES[lang]}`)
			process.exit(1)
		}
	}

	const startedAt = Date.now()

	for (const mode of ["authors", "attributed"] as const) {
		console.log(`Pass: ${mode}`)

		for (const lang of languages) {
			await processDump(DUMP_FILES[lang], lang, options, stats, mode, collected, allowedAuthors)
		}

		console.log(`  collected ${collected.length} citations, ${allowedAuthors.size} known authors`)
	}

	console.log(`Scanned in ${Date.now() - startedAt} ms`)

	stats.inferredYears = inferMissingYears(collected, buildWorkYearIndex(collected))
	const out = finalize(collected, stats)

	if (options.limit !== undefined) {
		out.length = Math.min(out.length, options.limit)
	}

	const document = out.join("")
	const totalBytes = Buffer.byteLength(document, "utf8")

	console.log("\nSummary")
	console.log(`  pages scanned:      ${stats.pages}`)
	console.log(`  in-scope authors:   ${stats.inScopePages}`)
	console.log(`  distinct authors:   ${stats.authors.size}`)
	console.log(`  citations seen:     ${stats.citations}`)
	console.log(`  inferred years:     ${stats.inferredYears}`)
	console.log(`  anonymous authors:  ${stats.anonymous}`)
	console.log(
		`  accepted:           ${stats.accepted} (fr ${stats.byLanguage.fr}, en ${stats.byLanguage.en})`,
	)
	console.log(`  duplicates:         ${stats.duplicates}`)
	console.log(`  out-of-scope:       ${stats.outOfScope}`)
	console.log(`  dropped:            ${JSON.stringify(stats.dropped)}`)
	console.log(`  output size:        ${(totalBytes / 1_048_576).toFixed(1)} MiB`)

	if (options.dry) {
		console.log("\nDry run: nothing written.")
		return
	}

	await Bun.write(options.outPath, document)
	console.log(`\nWrote ${options.outPath}`)
}

if (import.meta.main) {
	await main()
}
