import type { FC } from "react";

import { VStack } from "../layout/VStack";
import { Heading } from "../base/Heading";
import { Text } from "../base/Text";
import { Panel } from "../ui/Panel";
import type { AgentSource } from "../../server/agent/sources";

import "./SourcesPanel.css";

/** Props of the source list. */
export interface SourcesPanelProps {
	/** Deduplicated, ordered records the agent consulted. */
	sources: AgentSource[];
}

/**
 * The records the agent consulted, under the answer. Each row gives the brand, the year, and the
 * slogan. The list is empty until a tool returns a record.
 *
 * @example
 * 	<SourcesPanel sources={sources} />;
 *
 * @param props - The deduplicated sources.
 * @returns The source list, or nothing when it is empty.
 */
export const SourcesPanel: FC<SourcesPanelProps> = ({ sources }) => {
	if (sources.length === 0) {
		return null;
	}

	return (
		<Panel as="aside" gap="sm" padding="md" id="sources-panel">
			<Heading level={3} size="sm">
				Sources
			</Heading>
			<VStack gap="xs" id="sources-panel-list">
				{sources.map((source) => (
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
		</Panel>
	);
};
