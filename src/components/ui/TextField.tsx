import type { ChangeEvent, FC } from "react"
import { useId } from "react"

import { VStack } from "../layout/VStack"
import { Text } from "../base/Text"

import "./TextField.css"

/** Text-like input types accepted by `TextField`. */
export type TextFieldType = "text" | "search";

/** Props of the Design System text field. */
export interface TextFieldProps {
	/** Accessible label rendered above the control. */
	label: string;
	/** Input type. @defaultValue "text" */
	type?: TextFieldType;
	/** Controlled value. */
	value?: string;
	/** Change callback. */
	onValueChange?: (value: string) => void;
	/** Placeholder text shown inside the empty control. */
	placeholder?: string;
	/** Makes the field mandatory. @defaultValue false */
	required?: boolean;
	/** Native autocomplete hint. */
	autoComplete?: string;
	/** Disables the control. @defaultValue false */
	disabled?: boolean;
	/** Field name, used by the enclosing form on submit. */
	name?: string;
}

/**
 * Renders a labelled text control styled from the Design System tokens. Used
 * for the chat composer input.
 *
 * @param props - Label, input type, value hooks, and native constraints.
 * @returns The label and input markup, stacked with token spacing.
 * @example
 * <TextField label="Votre question" placeholder="Slogans sur le sucre" />
 */
export const TextField: FC<TextFieldProps> = ({
	label,
	type = "text",
	value,
	onValueChange,
	placeholder,
	required = false,
	autoComplete = "off",
	disabled = false,
	name,
}) => {
	// Bridges the DOM change event to the value-only callback.
	const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
		onValueChange?.(event.target.value)
	}

	// Ties the label to the input so clicking it focuses the control.
	const controlId = useId()

	return (
		<VStack gap="xs" className="text-field">
			<Text
				size="xs"
				tone="muted"
				weight="medium"
				as="label"
				htmlFor={controlId}
				className="text-field__label"
			>
				{label}
			</Text>
			{/* A raw input is required: no layout primitive renders a form control. */}
			<input
				className="text-field__control"
				id={controlId}
				type={type}
				name={name}
				value={value}
				onChange={handleChange}
				placeholder={placeholder}
				required={required}
				autoComplete={autoComplete}
				disabled={disabled}
			/>
		</VStack>
	)
}