import type { FC, ReactNode } from "react"

import "./Button.css"

/** Props of the button. */
export interface ButtonProps {
	/** Button label. */
	children: ReactNode;
	/** Visual weight: the one accent action, or a quiet secondary. */
	variant?: "primary" | "secondary";
	/** Submission behaviour. @defaultValue "button" */
	type?: "button" | "submit";
	/** Disables the button. @defaultValue false */
	disabled?: boolean;
	/** Click handler. */
	onClick?: () => void;
}

/**
 * The single action control. Primary is the accent fill; secondary is an
 * outline. No radius, no shadow.
 *
 * @param props - Label, variant, type, and state.
 * @returns A button element.
 * @example
 * <Button type="submit">Envoyer</Button>
 * <Button variant="secondary">Effacer</Button>
 */
export const Button: FC<ButtonProps> = ({
	children,
	variant = "primary",
	type = "button",
	disabled = false,
	onClick,
}) => (
	<button
		type={type}
		className={`button button--${variant}`}
		disabled={disabled}
		onClick={onClick}
	>
		{children}
	</button>
)