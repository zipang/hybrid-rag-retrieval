/**
 * MediaWiki dump page parsing and author scope filtering.
 *
 * The extractor keeps only author pages that belong to the classic literary
 * corpus: pages with a literary occupation category whose author is in the
 * public domain. Theme, work, and list pages are skipped.
 */

import { extractEnglishCitations, extractFrenchCitations } from "./extract"
import { type RawCitation, unescapeXml } from "./wikitext"

/** One page parsed from a MediaWiki XML dump. */
export type WikiPage = {
	/** Page title, with XML entities decoded. */
	title: string
	/** Numeric page identifier from the dump. */
	pageId: number
	/** Namespace number; only namespace zero pages are kept. */
	namespace: number
	/** Page wikitext, with XML entities decoded. */
	text: string
}

/** French categories that mark a literary author page. */
const FRENCH_LITERARY_CATEGORY =
	/Catégorie\s*:[^\]]*(poè|poet|écrivain|romancier|dramaturge|auteur|essayiste|conteu|fabuliste|nouvelliste|biographe|mémorialiste|prosateur|versificateur|chansonnier|librettiste|moraliste|philosophe|orateur|polémiste|pamphlétaire|critique littéraire|lettres|littérat|humaniste|diariste|poésie|dramaturgie)/i

/** English categories that mark a literary author page. */
const ENGLISH_LITERARY_CATEGORY =
	/Category\s*:[^\]]*(poet|writer|author|playwright|novelist|essayist|dramatist|fabulist|librettist|satirist|biographer|memoirist|storyteller|moralist|orator|poetess|literary critic|man of letters|woman of letters|diarist|philosopher|humanist|letter writer|literature)/i

/** Extract the `<text>` content and metadata from one `<page>` block. */
export const parsePageBlock = (block: string): WikiPage | undefined => {
	const titleMatch = /<title>([\s\S]*?)<\/title>/.exec(block)
	const namespaceMatch = /<ns>([\s\S]*?)<\/ns>/.exec(block)
	const idMatch = /<id>(\d+)<\/id>/.exec(block)
	const textMatch = /<text[^>]*>([\s\S]*?)<\/text>/.exec(block)

	if (titleMatch === null || namespaceMatch === null || idMatch === null || textMatch === null) {
		return undefined
	}

	return {
		title: unescapeXml(titleMatch[1]).trim(),
		pageId: Number(idMatch[1]),
		namespace: Number(namespaceMatch[1]),
		text: unescapeXml(textMatch[1]),
	}
}

/** Return true when the page text marks a French or English literary author. */
export const isLiteraryAuthor = (page: WikiPage): boolean => {
	return FRENCH_LITERARY_CATEGORY.test(page.text) || ENGLISH_LITERARY_CATEGORY.test(page.text)
}

/** Return true when a page is a redirect, a list, or a disambiguation page. */
export const isNonArticlePage = (page: WikiPage): boolean => {
	if (/^\s*#(?:REDIRECT|REDIRECTION)\b/i.test(page.text)) {
		return true
	}

	if (
		/\(disambiguation\)/i.test(page.title) ||
		/^List of\b/i.test(page.title) ||
		/^Liste de\b/i.test(page.title)
	) {
		return true
	}

	return false
}

/** Find the death year declared by a page category or by its opening line. */
export const findDeathYear = (page: WikiPage): number | undefined => {
	const french = /Décès en (\d{4})/.exec(page.text)

	if (french !== null) {
		return Number(french[1])
	}

	const englishCategory = /Category\s*:\s*(\d{4}) deaths/i.exec(page.text)

	if (englishCategory !== null) {
		return Number(englishCategory[1])
	}

	const opening = page.text.slice(0, 1200)
	const range =
		/\(([^()]{0,90}?)(\d{3,4})[^()]{0,25}?[–—-][^()]{0,35}?(\d{3,4})([^()]{0,50}?)\)/.exec(opening)

	return range === null ? undefined : Number(range[3])
}

/** Find the birth year declared by a page category or by its opening line. */
export const findBirthYear = (page: WikiPage): number | undefined => {
	const french = /Naissance en (\d{4})/.exec(page.text)

	if (french !== null) {
		return Number(french[1])
	}

	const englishCategory = /Category\s*:\s*(\d{4}) births/i.exec(page.text)

	if (englishCategory !== null) {
		return Number(englishCategory[1])
	}

	const opening = page.text.slice(0, 1200)
	const range =
		/\(([^()]{0,90}?)(\d{3,4})[^()]{0,25}?[–—-][^()]{0,35}?(\d{3,4})([^()]{0,50}?)\)/.exec(opening)

	return range === null ? undefined : Number(range[2])
}

/** Return true when an author is old enough for the public-domain filter. */
export const isPublicDomainAuthor = (page: WikiPage): boolean => {
	const deathYear = findDeathYear(page)

	if (deathYear !== undefined) {
		return deathYear <= 1956
	}

	const birthYear = findBirthYear(page)

	if (birthYear !== undefined) {
		return birthYear <= 1930
	}

	return false
}

/** Return true when a page is an author page inside the corpus scope. */
export const isInScope = (page: WikiPage): boolean => {
	return (
		page.namespace === 0 &&
		page.text.length > 200 &&
		!isNonArticlePage(page) &&
		isLiteraryAuthor(page)
	)
}

/** Extract citations from an author page according to the dump language. */
export const extractPageCitations = (page: WikiPage, lang: "fr" | "en"): RawCitation[] => {
	const title = page.title.replace(/\s*\([^)]*\)\s*$/, "").trim()

	return lang === "fr"
		? extractFrenchCitations(page.text, title)
		: extractEnglishCitations(page.text, title)
}

/** Extract citations from a theme or work page, reading author links. */
export const extractAttributedCitations = (page: WikiPage, lang: "fr" | "en"): RawCitation[] => {
	const title = page.title.replace(/\s*\([^)]*\)\s*$/, "").trim()

	return lang === "fr"
		? extractFrenchCitations(page.text, title, { attributed: true })
		: extractEnglishCitations(page.text, title, { attributed: true })
}

/** Normalize an author name for accent- and punctuation-insensitive matching. */
export const normalizeAuthor = (author: string): string => {
	return author
		.normalize("NFD")
		.replace(/\p{M}/gu, "")
		.toLocaleLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.replace(/\s+/g, " ")
		.trim()
}

/** Maximum number of sentences kept in one citation. */
export const MAX_QUOTE_SENTENCES = 3

/** Maximum number of characters kept in one citation. */
export const MAX_QUOTE_LENGTH = 500

/** Count sentence-ending marks, ignoring abbreviations, initials, and decimals. */
export const countSentences = (text: string): number => {
	const normalized = text
		.replace(
			/\b(?:Mr|Mrs|Ms|Dr|St|Mt|Prof|Gen|Col|Capt|Lt|Sgt|vs|etc|cf|Vol|No|Fig|p|pp|ed|trans|repr)\./gi,
			"$1",
		)
		.replace(/\b([A-Z])\./g, "$1")
		.replace(/(\d)\.(\d)/g, "$1$2")
		.replace(/\.{2,}|…/g, " ")
	const matches = normalized.match(/[.!?]+(?=\s|$)/g)

	return matches === null ? 1 : Math.max(1, matches.length)
}

/** Return true when a cleaned quote is short enough to index. */
export const isAcceptableQuote = (citation: RawCitation): boolean => {
	const quote = citation.quote

	if (quote.length < 15 || quote.length > MAX_QUOTE_LENGTH) {
		return false
	}

	if (countSentences(quote) > MAX_QUOTE_SENTENCES) {
		return false
	}

	if (/\{\{|\}\}|\[\[|\]\]/.test(quote)) {
		return false
	}

	if (!/[A-Za-zÀ-ÿ]/.test(quote)) {
		return false
	}

	if (/^https?:\/\//i.test(quote)) {
		return false
	}

	return true
}
