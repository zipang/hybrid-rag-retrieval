import type { FC } from "react"
import { useId } from "react"

import { VStack } from "../layout/VStack"
import { Text } from "../base/Text"

import "./TextArea.css"

/** Props of the question field. */
export interface TextAreaProps {
	/** Accessible label rendered above the control. */
	label: string;
	/** Controlled value. */
	value: string;
	/** Reports each edit of the value. */
	onValueChange: (value: string) => void;
	/** Submits the question. Enter alone; Shift+Enter adds a line. */
	onSubmit: () => void;
	/** Placeholder shown while empty. */
	placeholder?: string;
	/** Disables the control. @defaultValue false */
	disabled?: boolean;
}

/**
 * The question field: a textarea showing two lines. Enter submits the
 * question; Shift+Enter inserts a new line. The grow-to-fill behaviour is
 * native to a textarea, so no JavaScript is involved.
 *
 * @param props - Label, value, edit and submit handlers, and state.
 * @returns The label and the textarea.
 * @example
 * <TextArea label="Votre question" value={draft} onValueChange={setDraft} onSubmit={ask} />
 */
export const TextArea: FC<TextAreaProps> = ({
	label,
	value,
	onValueChange,
	onSubmit,
	placeholder,
	disabled = false,
}) => {
	const controlId = useId()

	return (
	<VStack gap="xs" id="question-field">
		<Text size="xs" tone="muted" weight="medium" as="label" htmlFor={controlId}>
			{label}
		</Text>
		<textarea
			id={controlId}
			className="text-area__control"
			value={value}
			onChange={(event) => onValueChange(event.target.value)}
			onKeyDown={(event) => {
				// Enter sends the question. Shift+Enter must reach the textarea
				// so the author can write a second line.
				if (event.key === "Enter" && !event.shiftKey) {
					event.preventDefault()
					onSubmit()
				}
			}}
			rows={2}
			placeholder={placeholder}
			disabled={disabled}
		/>
		</VStack>
	)
}