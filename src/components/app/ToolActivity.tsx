import type { FC } from "react";

import { Text } from "../base/Text";

import "./ToolActivity.css";

/** Props of the tool activity notice. */
export interface ToolActivityProps {
	/** Name of the tool the agent is running. */
	tool: string;
}

/**
 * A one-line notice shown while the agent runs a tool. It gives the reader a sign that the answer
 * is still being grounded in records.
 *
 * @example
 * 	<ToolActivity tool="searchRecords" />;
 *
 * @param props - The running tool name.
 * @returns The activity notice.
 */
export const ToolActivity: FC<ToolActivityProps> = ({ tool }) => (
	<Text size="xs" tone="muted" as="span" className="tool-activity">
		Recherche en cours ({tool})…
	</Text>
);
