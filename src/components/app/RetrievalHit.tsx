import type { FC } from "react"

import { VStack } from "../layout/VStack"
import { Text } from "../base/Text"
import type { SloganHit } from "../../lib/retrieval"

import "./RetrievalHit.css"

/** Props of one retrieved slogan. */
export interface RetrievalHitProps {
	/** The ranked slogan. */
	hit: SloganHit;
}

/**
 * One retrieved slogan: its brand and year in muted small type, the slogan
 * itself in the same size as a chat message.
 *
 * @param props - The ranked slogan.
 * @returns The slogan row.
 * @example
 * <RetrievalHit hit={hit} />
 */
export const RetrievalHit: FC<RetrievalHitProps> = ({ hit }) => (
	<VStack gap="xs" id={`retrieval-hit-${String(hit.id)}`} className="retrieval-hit">
		<Text size="xs" tone="muted" weight="medium" as="span">
			{hit.marque} {hit.annee}
		</Text>
		<Text size="sm" as="span" className="retrieval-hit__slogan">
			{hit.slogan}
		</Text>
	</VStack>
)