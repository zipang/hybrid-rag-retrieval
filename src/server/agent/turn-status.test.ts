import { describe, expect, test } from "bun:test";
import type { UIMessage } from "ai";
import { readTurnStatus } from "./turn-status";

/**
 * Build a UI message from parts.
 *
 * The cast injects the exact part shapes that the runtime produces; the test asserts the pure
 * function, not the SDK types.
 */
const message = (parts: unknown[]): UIMessage =>
	({ id: "m1", role: "assistant", parts }) as unknown as UIMessage;

describe("readTurnStatus", () => {
	test("reports thinking while the request is submitted", () => {
		expect(readTurnStatus("submitted", [])).toBe("thinking");
	});

	test("reports answering when the last message holds text", () => {
		const messages = [message([{ type: "text", text: "Bonjour" }])];

		expect(readTurnStatus("streaming", messages)).toBe("answering");
	});

	test("reports fetching when a tool call has its input ready", () => {
		const messages = [message([{ type: "tool-searchRecords", state: "input-available" }])];

		expect(readTurnStatus("streaming", messages)).toBe("fetching");
	});

	test("reports merging when a tool call has its output ready", () => {
		const messages = [message([{ type: "tool-searchRecords", state: "output-available" }])];

		expect(readTurnStatus("streaming", messages)).toBe("merging");
	});

	test("reports thinking while a tool call still streams its input", () => {
		const messages = [message([{ type: "tool-searchRecords", state: "input-streaming" }])];

		expect(readTurnStatus("streaming", messages)).toBe("thinking");
	});

	test("reports thinking when the last message is empty", () => {
		expect(readTurnStatus("streaming", [message([])])).toBe("thinking");
	});

	test("prefers the answer text over a pending tool call", () => {
		const messages = [
			message([
				{ type: "tool-searchRecords", state: "input-available" },
				{ type: "text", text: "Danone (2004)" }
			])
		];

		expect(readTurnStatus("streaming", messages)).toBe("answering");
	});

	test("reports answering when the turn is idle", () => {
		expect(readTurnStatus("ready", [message([{ type: "text", text: "Bonjour" }])])).toBe(
			"answering"
		);
	});

	test("reports answering when the turn failed", () => {
		expect(readTurnStatus("error", [])).toBe("answering");
	});
});
