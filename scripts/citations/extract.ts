/**
 * Extraction of citation records from Wikiquote page wikitext.
 *
 * `extractFrenchCitations` reads the `{{citation}}` and `{{Réf Livre}}`
 * templates that the French Wikiquote uses. `extractEnglishCitations` reads
 * the bullet quotes and work headings of the English Wikiquote.
 */

import {
	cleanText,
	extractTemplates,
	firstYear,
	pickWorkYear,
	type RawCitation,
	type RawTemplate,
	stripComments,
	stripEmphasis,
	stripLinks,
} from "./wikitext"

/** A wiki section heading with its body text and parsed year. */
export type Section = {
	/** Number of `=` characters around the heading. */
	level: number
	/** Cleaned heading text, without markup. */
	title: string
	/** Raw heading text, kept for year and template parsing. */
	rawTitle: string
	/** Body text between this heading and the next one. */
	body: string
	/** Character offset of the heading in the page text. */
	index: number
}

/** Link namespaces that never name an author. */
const NON_AUTHOR_LINK =
	/^(?:File|Image|Fichier|Catégorie|Category|s|wikt|wiktionary|wikisource)\s*:/i

/** Read the first author-looking wiki link in a fragment. */
export const authorFromLinks = (value: string): string => {
	const pattern = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g
	let match = pattern.exec(value)

	while (match !== null) {
		const target = match[1].trim()

		if (!NON_AUTHOR_LINK.test(target)) {
			const label = cleanText(match[2] ?? target)

			if (label.length > 1 && !/\d{4}/.test(label)) {
				return label
			}
		}

		match = pattern.exec(value)
	}

	return ""
}

/** Resolve the author, work title, and year carried by a French heading. */
export const parseFrenchHeading = (
	rawTitle: string,
): { author: string; work: string; year: number | undefined } => {
	const cleaned = cleanText(rawTitle)
	const year = firstYear(cleaned)
	const withoutYear = cleaned.replace(/\s*,?\s*\b(?:8\d{2}|9\d{2}|1\d{3}|20\d{2})\b[\s\S]*$/, "")
	const author = authorFromLinks(rawTitle.replace(/''[\s\S]*?''/g, " "))
	const work =
		author.length > 0 && withoutYear.toLocaleLowerCase().startsWith(author.toLocaleLowerCase())
			? withoutYear
					.slice(author.length)
					.replace(/^[\s,–—-]+/, "")
					.trim()
			: withoutYear.trim()

	return { author, work, year }
}

/** Resolve the work title and year carried by an English section heading. */
const parseEnglishHeading = (rawTitle: string): { work: string; year: number | undefined } => {
	const cleaned = cleanText(rawTitle)
	const year = firstYear(cleaned)
	const work = cleaned
		.replace(/[,\s(]*\b(?:8\d{2}|9\d{2}|1\d{3}|20\d{2})\b[\s\S]*$/, "")
		.replace(/[\s(,–—-]+$/, "")
		.trim()

	return { work, year }
}

/** Split page text into headed sections with their body text. */
export const splitSections = (page: string): Section[] => {
	const matches = [...page.matchAll(/^(={2,})\s*(.+?)\s*\1\s*$/gm)]
	const sections: Section[] = []

	for (let position = 0; position < matches.length; position += 1) {
		const match = matches[position]
		const rawTitle = match[2]
		const start = (match.index ?? 0) + match[0].length
		const nextMatch = matches[position + 1]
		const end = nextMatch === undefined ? page.length : (nextMatch.index ?? page.length)

		sections.push({
			level: match[1].length,
			title: cleanText(rawTitle),
			rawTitle,
			body: page.slice(start, end),
			index: match.index ?? 0,
		})
	}

	return sections
}

/** Return the section that encloses a character offset. */
export const sectionAt = (sections: Section[], offset: number): Section | undefined => {
	let current: Section | undefined

	for (const section of sections) {
		if (section.index <= offset) {
			current = section
			continue
		}

		break
	}

	return current
}

/** Sections of a French author page that hold third-party quotes. */
const FRENCH_EXCLUDED_SECTION =
	/concernant|rapport[ée]|à propos|au sujet|autres projets|liens externes|voir aussi|notes et références|références|bibliographie|annexes/i

/** Sections of an English author page that hold third-party quotes. */
const ENGLISH_EXCLUDED_SECTION =
	/quotes about|misattributed|external links|see also|references|further reading|disputed|proverbs|notes\b|sources\b/i

/** Template names that carry a French book reference. */
const isFrenchReferenceTemplate = (name: string): boolean => /^r[ée]f/.test(name)

/** Read named parameters that hold a French work title. */
const frenchWork = (template: RawTemplate): string => {
	return cleanText(
		template.named.get("titre de la contribution") ??
			template.named.get("titre") ??
			template.named.get("ouvrage") ??
			"",
	)
}

/** Read the French author parameter, falling back to the page author. */
const frenchAuthor = (template: RawTemplate): string => {
	return cleanText(
		template.named.get("auteur") ?? template.named.get("auteur de la contribution") ?? "",
	)
}

/** Extract citations from a French Wikiquote page. */
export const extractFrenchCitations = (
	page: string,
	pageTitle: string,
	options: EnglishCitationOptions = {},
): RawCitation[] => {
	const text = stripComments(page)
	const sections = splitSections(text)
	const templates = extractTemplates(text)
	const citations: RawCitation[] = []

	for (let position = 0; position < templates.length; position += 1) {
		const template = templates[position]

		if (template.name !== "citation") {
			continue
		}

		const section = sectionAt(sections, template.start)

		if (section !== undefined && FRENCH_EXCLUDED_SECTION.test(section.title)) {
			continue
		}

		const rawQuote =
			template.named.get("citation") ?? template.named.get("texte") ?? template.positional[0] ?? ""
		const quote = cleanText(rawQuote)

		let reference: RawTemplate | undefined
		const limit = Math.min(templates.length, position + 4)

		for (let lookahead = position + 1; lookahead < limit; lookahead += 1) {
			const candidate = templates[lookahead]

			if (isFrenchReferenceTemplate(candidate.name)) {
				reference = candidate
				break
			}

			if (candidate.name === "citation") {
				break
			}
		}

		const heading =
			section === undefined
				? { author: "", work: "", year: undefined }
				: parseFrenchHeading(section.rawTitle)
		const author = reference === undefined ? "" : frenchAuthor(reference)
		let work = reference === undefined ? "" : frenchWork(reference)
		const trad = reference === undefined ? "" : cleanText(reference.named.get("traducteur") ?? "")
		let year = reference === undefined ? undefined : pickWorkYear(reference.named)

		if (work.length === 0) {
			work = heading.work
		}

		if (year === undefined) {
			year = heading.year
		}

		let resolvedAuthor = author !== "" ? author : heading.author

		if (resolvedAuthor === "" && options.attributed !== true) {
			resolvedAuthor = pageTitle
		}

		citations.push({ author: resolvedAuthor, work, year, lang: "fr", trad, quote })
	}

	return citations
}

/** Options that control how the English extractor resolves an author. */
export type EnglishCitationOptions = {
	/**
	 * When true, read the author from the `[[Author]]` link of the attribution
	 * line. Use this mode on theme and work pages. When false, use the page
	 * title as the author.
	 */
	attributed?: boolean
}

/** Extract citations from an English Wikiquote page. */
export const extractEnglishCitations = (
	page: string,
	pageTitle: string,
	options: EnglishCitationOptions = {},
): RawCitation[] => {
	const text = stripComments(page)
	const sections = splitSections(text)
	const citations: RawCitation[] = []

	for (const section of sections) {
		if (ENGLISH_EXCLUDED_SECTION.test(section.title)) {
			continue
		}

		const heading = parseEnglishHeading(section.rawTitle)
		const headingWork = section.level >= 3 ? heading.work : ""
		const lines = section.body.split("\n")

		for (let index = 0; index < lines.length; index += 1) {
			const line = lines[index]

			if (!line.startsWith("*") || line.startsWith("**")) {
				continue
			}

			const quote = cleanText(line.replace(/^\*+\s*/, ""))
			let attribution = ""
			let cursor = index + 1

			while (cursor < lines.length && lines[cursor].startsWith("**")) {
				attribution += ` ${lines[cursor].replace(/^\*+\s*/, "")}`
				cursor += 1
			}

			let work = headingWork

			if (work.length === 0) {
				const italic = /''(.+?)''/.exec(attribution)
				work = italic === null ? "" : cleanText(stripLinks(stripEmphasis(italic[1])))
			}

			let year = headingWork.length > 0 ? heading.year : undefined

			if (year === undefined) {
				year = firstYear(attribution)
			}

			let author = pageTitle

			if (options.attributed === true) {
				author = authorFromLinks(attribution.replace(/''[\s\S]*?''/g, " "))
			}

			citations.push({ author, work, year, lang: "en", trad: "", quote })
			index = cursor - 1
		}
	}

	return citations
}
