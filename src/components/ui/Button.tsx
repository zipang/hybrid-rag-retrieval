import type { FC, ReactNode } from "react"

import "./Button.css"

/** Props of the Design System button. */
export interface ButtonProps {
	/** Content of the button, usually a short label. */
	children: ReactNode;
	/**
	 * Fill style: solid accent background or a quiet outline.
	 * @defaultValue "solid"
	 */
	variant?: "solid" | "outline";
	/** Submitted button state, used by the chat composer form.
	 *  @defaultValue "button" */
	type?: "button" | "submit";
	/** Stretches the button to the full width of its container.
	 *  @defaultValue false */
	fullWidth?: boolean;
	/** Disables the button and mutes its colors. @defaultValue false */
	disabled?: boolean;
	/** Click handler. Omit it for buttons handled by a parent form. */
	onClick?: () => void;
}

/**
 * Renders the primary action control: a square, flat label on the single
 * brand accent, or a quiet outline for secondary actions. Use it for every
 * screen action; no radius and no shadow, per the Design System.
 *
 * @param props - Label, variant, submission type, sizing, and click handler.
 * @returns A `<button>` styled by the Design System.
 * @example
 * <Button type="submit">Envoyer</Button>
 * <Button variant="outline" onClick={clear}>Effacer</Button>
 */
export const Button: FC<ButtonProps> = ({
	children,
	variant = "solid",
	type = "button",
	fullWidth = false,
	disabled = false,
	onClick,
}) => (
	<button
		type={type}
		className={[
			"button",
			`button--${variant}`,
			fullWidth ? "button--full-width" : "",
			disabled ? "button--disabled" : "",
		]
			.filter(Boolean)
			.join(" ")}
		disabled={disabled}
		onClick={onClick}
	>
		{children}
	</button>
)