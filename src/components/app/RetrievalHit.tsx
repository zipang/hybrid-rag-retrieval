import type { FC } from "react"

import { HStack } from "../layout/HStack"
import { Text } from "../base/Text"
import type { SloganHit } from "../../lib/retrieval"

import "./RetrievalHit.css"

/** Props of one retrieved slogan. */
export interface RetrievalHitProps {
	/** The ranked slogan. */
	hit: SloganHit;
}

/**
 * One retrieved slogan: its brand and year in muted type, the slogan itself
 * in body type.
 *
 * @param props - The ranked slogan.
 * @returns The slogan row.
 * @example
 * <RetrievalHit hit={hit} />
 */
export const RetrievalHit: FC<RetrievalHitProps> = ({ hit }) => (
	<HStack gap="xs" align="start" wrap className="retrieval-hit">
		<Text size="xs" tone="muted" weight="medium" as="span" className="retrieval-hit__brand">
			{hit.marque} {hit.annee}
		</Text>
		<Text size="sm" as="span" className="retrieval-hit__slogan">
			{hit.slogan}
		</Text>
	</HStack>
)