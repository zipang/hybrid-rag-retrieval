import { type FC, useEffect, useState } from "react"

import { VStack } from "../layout/VStack"
import { Heading } from "../base/Heading"
import { Text } from "../base/Text"
import { Panel } from "../ui/Panel"
import type { SloganHit } from "../../lib/retrieval"
import { RetrievalHit } from "./RetrievalHit"

/** How many slogans the panel shows. */
const TOP_K = 5

/** Props of the retrieval panel. */
export interface RetrievalPanelProps {
	/** The current question, or an empty string before the first question. */
	query: string;
	/** Whether the panel is shown at all. @defaultValue true */
	isVisible?: boolean;
}

/**
 * Fetches the slogans ranked for the current question. It owns no conversation
 * state: the query arrives as a prop.
 *
 * @param props - The query and the visibility flag.
 * @returns The ranked list, its empty state, or nothing when hidden.
 * @example
 * <RetrievalPanel query={question} />
 */
export const RetrievalPanel: FC<RetrievalPanelProps> = ({ query, isVisible = true }) => {
	const [hits, setHits] = useState<SloganHit[]>([])
	const [error, setError] = useState("")

	useEffect(() => {
		if (query.trim() === "") {
			setHits([])
			setError("")
			return
		}

		// A slow response for an old question must not replace a newer one.
		let isStale = false

		const load = async () => {
			try {
				const response = await fetch(
					`/api/slogans?q=${encodeURIComponent(query)}&topK=${TOP_K}`,
				)

				if (!response.ok) {
					throw new Error(`HTTP ${response.status}`)
				}

				const data = (await response.json()) as { results?: SloganHit[] }

				if (!isStale) {
					setHits(data.results ?? [])
					setError("")
				}
			} catch {
				if (!isStale) {
					setHits([])
					setError("La recherche a échoué.")
				}
			}
		}

		void load()

		return () => {
			isStale = true
		}
	}, [query])

	if (!isVisible) {
		return null
	}

	return (
		<Panel as="aside" gap="sm" padding="md" id="retrieval-panel">
			<Heading level={2} size="md">
				Slogans trouvés
			</Heading>

			{error !== "" ? (
				<Text size="sm" role="alert" id="retrieval-panel-error">
					{error}
				</Text>
			) : hits.length === 0 ? (
				<Text size="sm" tone="muted" id="retrieval-panel-empty">
					{query.trim() === ""
						? "Aucun slogan pour l'instant."
						: "Aucun slogan ne correspond à cette question."}
				</Text>
			) : (
				<VStack gap="sm" id="retrieval-panel-hits">
					{hits.map((hit) => (
						<RetrievalHit key={String(hit.id)} hit={hit} />
					))}
				</VStack>
			)}
		</Panel>
	)
}