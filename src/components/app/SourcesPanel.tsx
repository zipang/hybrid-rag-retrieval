import type { FC } from "react";

import { VStack } from "../layout/VStack";
import { Heading } from "../base/Heading";
import { Text } from "../base/Text";
import { Panel } from "../ui/Panel";
import type { TurnQuery } from "../../server/agent/sources";

import "./SourcesPanel.css";

/** Props of the source list. */
export interface SourcesPanelProps {
	/** Tool calls of the current turn, in order. */
	queries: TurnQuery[];
}

/**
 * The searches the agent ran in the current turn, grouped by query.
 *
 * Each group shows the tool's query and the sources that call returned. A continuation shows the
 * marker "Suite (page suivante)". The panel resets on each new question, because its `queries` prop
 * holds the last turn only.
 *
 * @example
 * 	<SourcesPanel queries={queries} />;
 *
 * @param props - The tool calls of the current turn.
 * @returns The grouped source list, or the empty state.
 */
export const SourcesPanel: FC<SourcesPanelProps> = ({ queries }) => (
	<Panel as="aside" gap="sm" padding="md" id="sources-panel">
		<Heading level={2} size="md">
			Sources
		</Heading>

		{queries.length === 0 ? (
			<Text size="sm" tone="muted" id="sources-panel-empty">
				Aucune recherche pour l'instant.
			</Text>
		) : (
			<VStack gap="md" id="sources-panel-list">
				{queries.map((query, index) => (
					<VStack
						key={`${query.tool}-${String(index)}`}
						gap="xs"
						className="source-group"
					>
						<Text size="xs" tone="muted" weight="medium" as="span">
							{query.tool === "fetchNextPage" ? "Suite (page suivante)" : query.query}
						</Text>
						{query.sources.map((source) => (
							<VStack key={String(source.id)} gap="xs" className="source-item">
								<Text size="xs" tone="muted" weight="medium" as="span">
									{source.marque} {source.annee}
								</Text>
								<Text size="sm" as="span" className="source-item__slogan">
									{source.slogan}
								</Text>
							</VStack>
						))}
					</VStack>
				))}
			</VStack>
		)}
	</Panel>
);
