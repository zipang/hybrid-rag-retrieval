import { VStack } from "@components/layout/VStack"
import { HStack } from "@components/layout/HStack"
import { Heading } from "@components/base/Heading"
import { Text } from "@components/base/Text"
import { Button } from "@components/ui/Button"
import { TextField } from "@components/ui/TextField"

import "./App.css"

/** Root of the application. Replaced by the chat page in T0003 Phase 3. */
export const App = () => (
	<VStack gap="xl" padding="xl" as="main" className="app">
		<VStack gap="xs">
			<Heading level={1}>Recherche de slogans</Heading>
			<Text tone="muted" size="sm">
				Recherche hybride dense + BM25, réponses par un LLM.
			</Text>
		</VStack>

		<HStack gap="md" alignItems="flex-end" className="app__row">
			<TextField label="Votre question" placeholder="Slogans sur le sucre" />
			<Button type="submit">Envoyer</Button>
			<Button variant="outline" disabled>
				Désactivé
			</Button>
		</HStack>
	</VStack>
)