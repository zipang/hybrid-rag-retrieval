import type { ChangeEvent, FC } from "react"
import { useId } from "react"

import { VStack } from "../layout/VStack"
import { Text } from "../base/Text"

import "./TextField.css"

/** Props of the text field. */
export interface TextFieldProps {
	/** Accessible label rendered above the control. */
	label: string;
	/** Controlled value. */
	value: string;
	/** Reports each keystroke. */
	onValueChange: (value: string) => void;
	/** Placeholder shown while the field is empty. @defaultValue none */
	placeholder?: string;
	/** Field name sent with the form. */
	name?: string;
	/** Disables the control. @defaultValue false */
	disabled?: boolean;
}

/**
 * A labelled single-line input, styled from the Design System tokens.
 *
 * @param props - Label, value, change handler, and native attributes.
 * @returns The label and input, stacked.
 * @example
 * <TextField label="Votre question" value={draft} onValueChange={setDraft} />
 */
export const TextField: FC<TextFieldProps> = ({
	label,
	value,
	onValueChange,
	placeholder,
	name,
	disabled = false,
}) => {
	const controlId = useId()

	// Bridges the DOM event to a plain string callback.
	const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
		onValueChange(event.target.value)
	}

	return (
		<VStack gap="xs" className="text-field">
			<Text size="xs" tone="muted" weight="medium" as="label" htmlFor={controlId}>
				{label}
			</Text>
			<input
				id={controlId}
				className="text-field__control"
				name={name}
				type="text"
				value={value}
				onChange={handleChange}
				placeholder={placeholder}
				autoComplete="off"
				disabled={disabled}
			/>
		</VStack>
	)
}