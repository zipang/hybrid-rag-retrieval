/** Project-root ambient declarations for non-TypeScript imports bundled by Bun. */

declare module "*.css" {}

declare module "*.html" {
	/** Bun's HTML import resolves to a value accepted by the `routes` option. */
	const route: unknown
	export default route
}
