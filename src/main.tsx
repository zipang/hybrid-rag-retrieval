import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { App } from "./App"
import "../design-tokens.css"
import "../color-variants.css"
import "./styles/fonts.css"
import "./styles/reset.css"

const rootElt = document.getElementById("root")

// The entrypoint template owns #root; without it there is nothing to mount onto.
if (!rootElt) {
	throw new Error("Missing #root element")
}

createRoot(rootElt).render(
	<StrictMode>
		<App />
	</StrictMode>,
)