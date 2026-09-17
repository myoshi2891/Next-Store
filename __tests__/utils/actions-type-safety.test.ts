import { describe, it, expect, expectTypeOf } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import type { actionFunction } from "../../utils/types";

describe("Server Action の prevState 型安全性", () => {
	it("actionFunction 型に any が含まれていないこと", () => {
		expectTypeOf<actionFunction>().parameter(0).not.toBeAny();
		expectTypeOf<actionFunction>().parameter(1).not.toBeAny();
		expectTypeOf<actionFunction>().returns.not.toBeAny();
	});

	it("actionFunction の shape が (prevState, formData) => Promise<{ message: string }> であること", () => {
		expectTypeOf<actionFunction>().parameter(0).toEqualTypeOf<{
			message: string;
		}>();
		expectTypeOf<actionFunction>().parameter(1).toEqualTypeOf<FormData>();
		expectTypeOf<actionFunction>().returns.toEqualTypeOf<
			Promise<{ message: string }>
		>();
	});

	it("utils/actions.ts の prevState に any が使われていないこと", () => {
		const content = readFileSync(
			resolve(__dirname, "../../utils/actions.ts"),
			"utf-8"
		);
		const lines = content.split("\n");
		const prevStateLines = lines.filter((line) =>
			line.includes("prevState")
		);

		for (const line of prevStateLines) {
			expect(
				line,
				`actions.ts: "${line.trim()}" で prevState: any が使われています`
			).not.toMatch(/prevState\s*:\s*any/);
		}
	});

	it("FormContainer の initialState が actionFunction の prevState 型と一致する", () => {
		const initialState = { message: "" };
		expectTypeOf(initialState).toEqualTypeOf<
			Parameters<actionFunction>[0]
		>();
	});
});
